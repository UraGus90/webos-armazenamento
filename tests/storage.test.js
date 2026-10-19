'use strict';

const test = require('node:test');
const assert = require('assert');
const storage = require('../service/lib/storage');
const { InputError } = require('../service/lib/parse');

const APPS = '/media/developer/apps/usr/palm/applications';
const SERVICES = '/media/developer/apps/usr/palm/services';
const DF_HEADER = 'Filesystem 1024-blocks Used Available Capacity Mounted on\n';

function df(device, total, used, avail, mount) {
  return DF_HEADER + `${device} ${total} ${used} ${avail} 1% ${mount}\n`;
}

// Simula a TV: saídas de comandos, arquivos, pastas e links.
function fakeDeps({ outputs = {}, files = {}, dirs = [], links = {} } = {}) {
  const dirSet = new Set(dirs);
  const calls = [];
  return {
    calls,
    exec: async (file, args) => {
      calls.push({ file, args });
      const key = [file].concat(args).join(' ');
      const out = outputs[key];
      if (out instanceof Error) throw out;
      if (typeof out === 'string') return { stdout: out };
      throw Object.assign(new Error('sem saída simulada: ' + key), { stdout: '' });
    },
    readFile: (p) => {
      if (p in files) return files[p];
      throw new Error('ENOENT');
    },
    statSize: (p) => {
      if (p in files) return Buffer.byteLength(files[p]);
      throw new Error('ENOENT');
    },
    realpath: (p) => {
      if (p in links) return links[p];
      if (dirSet.has(p)) return p;
      throw new Error('ENOENT');
    },
    isDir: (p) => dirSet.has(p),
    now: () => '2026-10-19T12:00:00.000Z',
  };
}

function overviewOutputs(extra = {}) {
  return Object.assign({
    '/bin/df -P -k /media/developer': df('/dev/mmcblk0p59', 1433616, 594988, 822244, '/media/cryptofs/x'),
    '/bin/df -P -k /var/luna/preferences': df('/dev/mmcblk0p58', 738048, 167912, 516376, '/var/luna/preferences'),
    '/bin/df -P -k /tmp': df('tmpfs', 626008, 20196, 605812, '/tmp'),
    [`/usr/bin/du -k -d 1 ${APPS}`]: [
      `320636\t${APPS}/org.xbmc.kodi`,
      `1820\t${APPS}/youtube.leanback.v4`,
      `50\t${APPS}/nome com espaço`,
      `188\t${APPS}/com.pirate.refresh`,
      `322644\t${APPS}`,
    ].join('\n'),
    [`/usr/bin/du -k -d 1 ${SERVICES}`]: `16\t${SERVICES}/com.pirate.refresh.service\n16\t${SERVICES}\n`,
  }, extra);
}

test('getOverview junta áreas e apps de desenvolvedor', async () => {
  const deps = fakeDeps({
    outputs: overviewOutputs(),
    files: {
      '/proc/mounts': 'tmpfs /tmp/usb tmpfs rw 0 0\n',
      [`${APPS}/org.xbmc.kodi/appinfo.json`]: JSON.stringify({ title: '  Kodi  ' }),
      [`${APPS}/youtube.leanback.v4/appinfo.json`]: '{ inválido',
      [`${APPS}/com.pirate.refresh/appinfo.json`]: JSON.stringify({ title: 'x'.repeat(200) }),
    },
  });
  const result = await storage.getOverview(deps);

  assert.deepStrictEqual(result.areas.map((a) => a.id), ['apps', 'prefs', 'tmp']);
  assert.deepStrictEqual(result.areas[0], {
    id: 'apps', path: '/media/developer', device: '/dev/mmcblk0p59', totalK: 1433616, usedK: 594988, availK: 822244,
  });
  assert.deepStrictEqual(result.apps.map((a) => [a.id, a.kind, a.title, a.sizeK]), [
    ['org.xbmc.kodi', 'app', 'Kodi', 320636],
    ['youtube.leanback.v4', 'app', null, 1820],
    ['com.pirate.refresh', 'app', 'x'.repeat(80), 188],
    ['com.pirate.refresh.service', 'service', null, 16],
  ]);
  assert.strictEqual(result.partial, false);
  assert.strictEqual(result.generatedAt, '2026-10-19T12:00:00.000Z');
});

test('getOverview só executa binários fixos com argumentos em lista', async () => {
  const deps = fakeDeps({ outputs: overviewOutputs(), files: { '/proc/mounts': '' } });
  await storage.getOverview(deps);
  for (const call of deps.calls) {
    assert.ok([storage.BIN.df, storage.BIN.du].includes(call.file), call.file);
    assert.ok(Array.isArray(call.args));
  }
});

test('getOverview inclui pendrive montado e tolera falhas isoladas', async () => {
  const outputs = overviewOutputs({
    '/bin/df -P -k /tmp/usb/sda/sda1': df('/dev/sda1', 1000, 250, 750, '/tmp/usb/sda/sda1'),
    '/bin/df -P -k /tmp': new Error('df quebrou'),
  });
  delete outputs[`/usr/bin/du -k -d 1 ${SERVICES}`];
  const deps = fakeDeps({ outputs, files: { '/proc/mounts': '/dev/sda1 /tmp/usb/sda/sda1 vfat rw 0 0\n' } });
  const result = await storage.getOverview(deps);
  assert.deepStrictEqual(result.areas.map((a) => a.id), ['apps', 'prefs', 'usb1']);
  assert.strictEqual(result.partial, true);
  assert.ok(result.apps.every((a) => a.kind === 'app'));
});

test('getOverview ignora appinfo.json grande demais', async () => {
  const big = JSON.stringify({ title: 'Grande', pad: 'x'.repeat(storage.MAX_APPINFO_BYTES) });
  const deps = fakeDeps({
    outputs: overviewOutputs(),
    files: { '/proc/mounts': '', [`${APPS}/org.xbmc.kodi/appinfo.json`]: big },
  });
  const result = await storage.getOverview(deps);
  assert.strictEqual(result.apps[0].title, null);
});

test('getUsage lista arquivos e pastas da pasta pedida', async () => {
  const kodi = APPS + '/org.xbmc.kodi';
  const deps = fakeDeps({
    dirs: [kodi, kodi + '/addons'],
    outputs: {
      [`/usr/bin/du -k -a -d 1 ${kodi}`]: `134996\t${kodi}/addons\n72480\t${kodi}/kodi-webos\n320636\t${kodi}\n`,
    },
  });
  const result = await storage.getUsage(deps, { path: kodi + '/' });
  assert.deepStrictEqual(result, {
    path: kodi,
    totalK: 320636,
    children: [
      { name: 'addons', sizeK: 134996, isDir: true },
      { name: 'kodi-webos', sizeK: 72480, isDir: false },
    ],
    hiddenCount: 0,
    hiddenK: 0,
    partial: false,
  });
});

test('getUsage limita a quantidade de itens e soma o resto', async () => {
  const dir = APPS + '/grande';
  const lines = [];
  for (let i = 0; i < storage.MAX_CHILDREN + 5; i++) lines.push(`${1000 - i}\t${dir}/f${i}`);
  const deps = fakeDeps({ dirs: [dir], outputs: { [`/usr/bin/du -k -a -d 1 ${dir}`]: lines.join('\n') } });
  const result = await storage.getUsage(deps, { path: dir });
  assert.strictEqual(result.children.length, storage.MAX_CHILDREN);
  assert.strictEqual(result.hiddenCount, 5);
  assert.strictEqual(result.hiddenK, 960 + 959 + 958 + 957 + 956);
});

test('getUsage recusa link simbólico que aponta para fora da área', async () => {
  const deps = fakeDeps({ links: { [APPS + '/fuga']: '/etc' } });
  await assert.rejects(storage.getUsage(deps, { path: APPS + '/fuga' }), InputError);
  assert.strictEqual(deps.calls.length, 0);
});

test('getUsage recusa parâmetros inválidos sem executar nada', async () => {
  const deps = fakeDeps();
  for (const params of [undefined, null, {}, { path: 1 }, { path: '/etc' }, { path: APPS + '/../../..' }]) {
    await assert.rejects(storage.getUsage(deps, params), InputError);
  }
  await assert.rejects(storage.getUsage(deps, { path: APPS + '/inexistente' }), /não encontrada/);
  assert.strictEqual(deps.calls.length, 0);
});

test('getUsage passa nomes estranhos como um único argumento, sem shell', async () => {
  const dir = APPS + '/x;rm -rf $(echo y)';
  const deps = fakeDeps({ dirs: [dir], outputs: { [`/usr/bin/du -k -a -d 1 ${dir}`]: `1\t${dir}\n` } });
  await storage.getUsage(deps, { path: dir });
  assert.deepStrictEqual(deps.calls[0], { file: '/usr/bin/du', args: ['-k', '-a', '-d', '1', dir] });
});

test('getUsage aproveita saída parcial do du e falha limpo em timeout', async () => {
  const dir = APPS + '/kodi';
  const partialErr = Object.assign(new Error('exit 1'), { stdout: `10\t${dir}/a\n10\t${dir}\n` });
  let deps = fakeDeps({ dirs: [dir], outputs: { [`/usr/bin/du -k -a -d 1 ${dir}`]: partialErr } });
  assert.strictEqual((await storage.getUsage(deps, { path: dir })).partial, true);

  const timeout = Object.assign(new Error('killed'), { killed: true, stdout: `10\t${dir}/a\n` });
  deps = fakeDeps({ dirs: [dir], outputs: { [`/usr/bin/du -k -a -d 1 ${dir}`]: timeout } });
  await assert.rejects(storage.getUsage(deps, { path: dir }), (err) => !(err instanceof InputError) && err.message === 'du falhou');
});
