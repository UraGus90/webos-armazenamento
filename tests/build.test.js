'use strict';

const test = require('node:test');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { buildIpk } = require('../tools/build-ipk');

const ID = 'org.local.armazenamento';

function readAr(buf) {
  assert.strictEqual(buf.slice(0, 8).toString('ascii'), '!<arch>\n');
  const members = [];
  let pos = 8;
  while (pos < buf.length) {
    const header = buf.slice(pos, pos + 60).toString('ascii');
    assert.strictEqual(header.slice(58, 60), '`\n');
    const size = parseInt(header.slice(48, 58), 10);
    members.push({ name: header.slice(0, 16).trim(), data: buf.slice(pos + 60, pos + 60 + size) });
    pos += 60 + size + (size % 2);
  }
  return members;
}

function readTarGz(buf) {
  const tar = zlib.gunzipSync(buf);
  const files = {};
  let pos = 0;
  while (pos + 512 <= tar.length) {
    const header = tar.slice(pos, pos + 512);
    if (header.every((b) => b === 0)) break;
    const field = (start, len) => header.slice(start, start + len).toString('utf8').replace(/\0.*$/s, '');
    const prefix = field(345, 155);
    const name = (prefix ? prefix + '/' : '') + field(0, 100);
    const size = parseInt(field(124, 12), 8);
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : header[i];
    assert.strictEqual(parseInt(field(148, 8), 8), sum, 'checksum de ' + name);
    files[name] = { type: field(156, 1), data: tar.slice(pos + 512, pos + 512 + size) };
    pos += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

function build() {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipk-'));
  try {
    const result = buildIpk({ outDir });
    return { name: path.basename(result.file), bytes: fs.readFileSync(result.file) };
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
}

test('o .ipk tem o formato esperado e só os arquivos do app e do serviço', () => {
  const { name, bytes } = build();
  assert.strictEqual(name, ID + '_0.1.0_all.ipk');

  const members = readAr(bytes);
  assert.deepStrictEqual(members.map((m) => m.name), ['debian-binary', 'control.tar.gz', 'data.tar.gz']);
  assert.strictEqual(members[0].data.toString(), '2.0\n');

  const control = readTarGz(members[1].data)['./control'].data.toString();
  assert.match(control, new RegExp('^Package: ' + ID.replace(/\./g, '\\.') + '$', 'm'));
  assert.match(control, /^Version: 0\.1\.0$/m);

  const data = readTarGz(members[2].data);
  const names = Object.keys(data);
  for (const required of [
    `./usr/palm/applications/${ID}/appinfo.json`,
    `./usr/palm/applications/${ID}/index.html`,
    `./usr/palm/applications/${ID}/icon.png`,
    `./usr/palm/services/${ID}.service/service.js`,
    `./usr/palm/services/${ID}.service/services.json`,
    `./usr/palm/services/${ID}.service/lib/storage.js`,
    `./usr/palm/services/${ID}.service/lib/clean.js`,
    `./usr/palm/packages/${ID}/packageinfo.json`,
  ]) {
    assert.ok(names.includes(required), 'faltando ' + required);
  }
  assert.ok(!names.some((n) => /tests?\/|prototype|mock-service|tools\/|\.test\.js/.test(n)), names.join('\n'));
  assert.ok(names.every((n) => n.startsWith('./')));

  const info = JSON.parse(data[`./usr/palm/packages/${ID}/packageinfo.json`].data);
  assert.deepStrictEqual(info, { app: ID, id: ID, version: '0.1.0', services: [ID + '.service'] });
});

test('o build é reproduzível', () => {
  assert.ok(build().bytes.equals(build().bytes));
});
