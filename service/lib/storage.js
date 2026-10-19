'use strict';

// Leitura do armazenamento. Toda E/S passa por `deps` para poder ser simulada nos testes.

const posix = require('path').posix;
const { NAME_RE, InputError, parseDf, parseDu, isInside, resolveAllowed, parseUsbMounts, parseMeminfo } = require('./parse');

const PALM = '/media/developer/apps/usr/palm';
const BROWSABLE_ROOTS = [PALM + '/applications', PALM + '/services'];
const AREAS = [
  { id: 'apps', path: '/media/developer' },
  { id: 'prefs', path: '/var/luna/preferences' },
  { id: 'tmp', path: '/tmp' },
];
const USB_ROOT = '/tmp/usb';
const BIN = { df: '/bin/df', du: '/usr/bin/du' };
const MAX_CHILDREN = 40;
const MAX_APPINFO_BYTES = 64 * 1024;

// Executa um binário fixo. Se ele sair com erro mas tiver produzido saída
// (ex.: du sem permissão numa subpasta), usa a saída e marca o resultado como parcial.
async function run(deps, file, args) {
  try {
    const { stdout } = await deps.exec(file, args);
    return { stdout, partial: false };
  } catch (err) {
    if (err && !err.killed && typeof err.stdout === 'string' && err.stdout.trim()) {
      return { stdout: err.stdout, partial: true };
    }
    throw new Error(posix.basename(file) + ' falhou');
  }
}

async function readArea(deps, area) {
  try {
    const { stdout } = await run(deps, BIN.df, ['-P', '-k', area.path]);
    const row = parseDf(stdout)[0];
    if (!row) return null;
    return { id: area.id, path: area.path, device: row.device, totalK: row.totalK, usedK: row.usedK, availK: row.availK };
  } catch (err) {
    return null;
  }
}

function readTitle(deps, appDir) {
  try {
    const file = appDir + '/appinfo.json';
    if (deps.statSize(file) > MAX_APPINFO_BYTES) return null;
    const info = JSON.parse(deps.readFile(file));
    if (typeof info.title !== 'string') return null;
    return info.title.trim().slice(0, 80) || null;
  } catch (err) {
    return null;
  }
}

async function readDevApps(deps) {
  const apps = [];
  let partial = false;
  for (const root of BROWSABLE_ROOTS) {
    let du;
    try {
      du = await run(deps, BIN.du, ['-k', '-d', '1', root]);
    } catch (err) {
      partial = true;
      continue;
    }
    partial = partial || du.partial;
    const kind = root === BROWSABLE_ROOTS[0] ? 'app' : 'service';
    for (const child of parseDu(du.stdout, root).children) {
      if (!NAME_RE.test(child.name)) continue;
      const path = root + '/' + child.name;
      apps.push({ id: child.name, kind, title: kind === 'app' ? readTitle(deps, path) : null, sizeK: child.sizeK, path });
    }
  }
  apps.sort((a, b) => b.sizeK - a.sizeK);
  return { apps, partial };
}

function readMemory(deps) {
  try {
    return parseMeminfo(deps.readFile('/proc/meminfo'));
  } catch (err) {
    return null;
  }
}

async function getOverview(deps) {
  let usb = [];
  try {
    usb = parseUsbMounts(deps.readFile('/proc/mounts'), USB_ROOT);
  } catch (err) {
    usb = [];
  }
  const areaDefs = AREAS.concat(usb.map((path, i) => ({ id: 'usb' + (i + 1), path })));
  const areas = (await Promise.all(areaDefs.map((area) => readArea(deps, area)))).filter(Boolean);
  const { apps, partial } = await readDevApps(deps);
  return { areas, apps, memory: readMemory(deps), partial, generatedAt: deps.now() };
}

// Tamanho total de uma pasta (du -s). Usado pela limpeza de cache.
async function measure(deps, path) {
  const du = await run(deps, BIN.du, ['-k', '-s', path]);
  return { totalK: parseDu(du.stdout, path).totalK, partial: du.partial };
}

function isDir(deps, p) {
  try {
    return deps.isDir(p);
  } catch (err) {
    return false;
  }
}

async function getUsage(deps, params) {
  const requested = resolveAllowed(params && params.path, BROWSABLE_ROOTS);
  let real;
  try {
    real = deps.realpath(requested);
  } catch (err) {
    throw new InputError('Pasta não encontrada.');
  }
  // Um link simbólico dentro da área permitida não pode levar para fora dela.
  if (!isInside(real, BROWSABLE_ROOTS)) throw new InputError('Caminho fora da área permitida.');

  const du = await run(deps, BIN.du, ['-k', '-a', '-d', '1', real]);
  const { totalK, children } = parseDu(du.stdout, real);
  const shown = children.slice(0, MAX_CHILDREN).map((c) => ({
    name: c.name,
    sizeK: c.sizeK,
    isDir: isDir(deps, real + '/' + c.name),
  }));
  const hidden = children.slice(MAX_CHILDREN);
  return {
    path: real,
    totalK,
    children: shown,
    hiddenCount: hidden.length,
    hiddenK: hidden.reduce((sum, c) => sum + c.sizeK, 0),
    partial: du.partial,
  };
}

module.exports = { getOverview, getUsage, measure, BROWSABLE_ROOTS, BIN, MAX_CHILDREN, MAX_APPINFO_BYTES };
