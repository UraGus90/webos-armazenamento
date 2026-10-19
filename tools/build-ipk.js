'use strict';

// Empacota app/ + service/ em um .ipk instalável no modo desenvolvedor do webOS,
// sem depender do ares-cli. O formato é um arquivo `ar` com debian-binary,
// control.tar.gz e data.tar.gz. Datas e donos fixos deixam o build reproduzível.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const MTIME = 1767225600; // 2026-01-01T00:00:00Z
const PACKAGER_VERSION = '0.1.0';
const SERVICE_FILES = ['service.js', 'package.json', 'services.json', 'lib'];

function walk(dir, base = dir) {
  const out = [];
  for (const name of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    const stat = fs.lstatSync(full);
    if (stat.isSymbolicLink()) throw new Error('Link simbólico não permitido no pacote: ' + full);
    if (stat.isDirectory()) out.push(...walk(full, base));
    else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

function octal(value, width) {
  return value.toString(8).padStart(width - 1, '0') + '\0';
}

function tarHeader(name, size, type) {
  const header = Buffer.alloc(512);
  let prefix = '';
  if (Buffer.byteLength(name) > 100) {
    const cut = name.lastIndexOf('/', 155);
    prefix = name.slice(0, cut);
    name = name.slice(cut + 1);
    if (Buffer.byteLength(name) > 100 || Buffer.byteLength(prefix) > 155) throw new Error('Caminho longo demais: ' + name);
  }
  header.write(name, 0, 100, 'utf8');
  header.write(octal(type === '5' ? 0o755 : 0o644, 8), 100, 'ascii');
  header.write(octal(0, 8), 108, 'ascii');
  header.write(octal(0, 8), 116, 'ascii');
  header.write(octal(size, 12), 124, 'ascii');
  header.write(octal(MTIME, 12), 136, 'ascii');
  header.write('        ', 148, 'ascii');
  header.write(type, 156, 'ascii');
  header.write('ustar\0', 257, 'ascii');
  header.write('00', 263, 'ascii');
  header.write('root', 265, 'ascii');
  header.write('root', 297, 'ascii');
  header.write(prefix, 345, 155, 'utf8');
  let sum = 0;
  for (const b of header) sum += b;
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii');
  return header;
}

// entries: [{ name, data? }] — sem data = diretório.
function tarGz(entries) {
  const parts = [];
  for (const entry of entries) {
    if (entry.data === undefined) {
      parts.push(tarHeader(entry.name.replace(/\/?$/, '/'), 0, '5'));
    } else {
      parts.push(tarHeader(entry.name, entry.data.length, '0'), entry.data);
      const pad = (512 - (entry.data.length % 512)) % 512;
      if (pad) parts.push(Buffer.alloc(pad));
    }
  }
  parts.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(parts), { level: 9 });
}

function arHeader(name, size) {
  const field = (text, width) => text.padEnd(width, ' ');
  return Buffer.from(
    field(name, 16) + field(String(MTIME), 12) + field('0', 6) + field('0', 6) + field('100644', 8) + field(String(size), 10) + '`\n',
    'ascii'
  );
}

function ar(members) {
  const parts = [Buffer.from('!<arch>\n', 'ascii')];
  for (const { name, data } of members) {
    parts.push(arHeader(name, data.length), data);
    if (data.length % 2) parts.push(Buffer.from('\n'));
  }
  return Buffer.concat(parts);
}

function addTree(entries, dirs, prefix, files, readFile) {
  for (const rel of files) {
    const target = prefix + '/' + rel;
    const segments = target.split('/');
    for (let i = 2; i < segments.length; i++) {
      const dir = segments.slice(0, i).join('/');
      if (!dirs.has(dir)) {
        dirs.add(dir);
        entries.push({ name: dir });
      }
    }
    entries.push({ name: target, data: readFile(rel) });
  }
}

function buildIpk({ rootDir = path.join(__dirname, '..'), outDir = path.join(rootDir, 'dist') } = {}) {
  const appDir = path.join(rootDir, 'app');
  const serviceDir = path.join(rootDir, 'service');
  const appinfo = JSON.parse(fs.readFileSync(path.join(appDir, 'appinfo.json'), 'utf8'));
  const servicePkg = JSON.parse(fs.readFileSync(path.join(serviceDir, 'package.json'), 'utf8'));
  const services = JSON.parse(fs.readFileSync(path.join(serviceDir, 'services.json'), 'utf8'));

  const id = appinfo.id;
  const serviceId = services.id;
  if (!/^[a-z0-9]+(\.[a-z0-9-]+)+$/.test(id)) throw new Error('id do app inválido: ' + id);
  if (serviceId !== id + '.service' || servicePkg.name !== serviceId) throw new Error('id do serviço deve ser "' + id + '.service".');
  if (servicePkg.version !== appinfo.version) throw new Error('Versões diferentes entre app e serviço.');
  for (const icon of [appinfo.icon, appinfo.largeIcon]) {
    if (!fs.existsSync(path.join(appDir, icon))) throw new Error('Ícone ausente: ' + icon + ' (rode npm run icons).');
  }

  const appFiles = walk(appDir);
  const serviceFiles = walk(serviceDir).filter((f) => SERVICE_FILES.includes(f.split('/')[0]));
  const packageinfo = Buffer.from(JSON.stringify({ app: id, id, version: appinfo.version, services: [serviceId] }, null, 2) + '\n');

  const entries = [];
  const dirs = new Set();
  addTree(entries, dirs, './usr/palm/applications/' + id, appFiles, (f) => fs.readFileSync(path.join(appDir, f)));
  addTree(entries, dirs, './usr/palm/services/' + serviceId, serviceFiles, (f) => fs.readFileSync(path.join(serviceDir, f)));
  addTree(entries, dirs, './usr/palm/packages/' + id, ['packageinfo.json'], () => packageinfo);

  const installedBytes = entries.reduce((sum, e) => sum + (e.data ? e.data.length : 0), 0);
  const control = [
    'Package: ' + id,
    'Version: ' + appinfo.version,
    'Section: misc',
    'Priority: optional',
    'Architecture: all',
    'Installed-Size: ' + installedBytes,
    'Maintainer: N/A <nobody@example.com>',
    'Description: ' + appinfo.title,
    'webOS-Package-Format-Version: 2',
    'webOS-Packager-Version: ' + PACKAGER_VERSION,
    '',
  ].join('\n');

  const ipk = ar([
    { name: 'debian-binary', data: Buffer.from('2.0\n') },
    { name: 'control.tar.gz', data: tarGz([{ name: './' }, { name: './control', data: Buffer.from(control) }]) },
    { name: 'data.tar.gz', data: tarGz([{ name: './' }].concat(entries)) },
  ]);

  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, id + '_' + appinfo.version + '_all.ipk');
  fs.writeFileSync(file, ipk);
  return { file, size: ipk.length, appFiles, serviceFiles };
}

if (require.main === module) {
  const { file, size } = buildIpk();
  console.log('Pacote gerado: ' + file + ' (' + size + ' bytes)');
}

module.exports = { buildIpk };
