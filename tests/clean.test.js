'use strict';

const test = require('node:test');
const assert = require('assert');
const clean = require('../service/lib/clean');
const { InputError } = require('../service/lib/parse');

const KODI = clean.KODI;
const THUMBS = KODI + '/.kodi/userdata/Thumbnails';
const PKGS = KODI + '/.kodi/addons/packages';
const TEMP = KODI + '/.kodi/temp';

// Sistema de arquivos em memória para exercitar leitura e deleção.
function fakeFs({ dirs = [], files = {}, symlinks = {}, realpaths = {} } = {}) {
  const dirSet = new Set(dirs);
  const fileMap = new Map(Object.entries(files));
  const linkMap = new Map(Object.entries(symlinks));
  const removed = [];

  const exists = (p) => dirSet.has(p) || fileMap.has(p) || linkMap.has(p);
  const childrenOf = (p) => {
    const names = new Set();
    for (const full of [].concat([...dirSet], [...fileMap.keys()], [...linkMap.keys()])) {
      if (full.startsWith(p + '/')) {
        const rest = full.slice(p.length + 1);
        if (rest.indexOf('/') === -1) names.add(rest);
        else names.add(rest.slice(0, rest.indexOf('/')));
      }
    }
    return [...names];
  };

  const sizeUnder = (p) => {
    let k = 1; // a própria pasta conta ~1 bloco, como o du
    for (const [f, size] of fileMap) if (f === p || f.startsWith(p + '/')) k += Math.ceil(size / 1024);
    return k;
  };

  const deps = {
    removed,
    isDir: (p) => dirSet.has(p),
    realpath: (p) => {
      if (realpaths[p]) return realpaths[p];
      if (exists(p)) return p;
      throw new Error('ENOENT');
    },
    readdir: (p) => {
      if (!dirSet.has(p)) throw new Error('ENOTDIR');
      return childrenOf(p);
    },
    lstat: (p) => {
      if (linkMap.has(p)) return { isDir: false, isSymlink: true, size: 12 };
      if (dirSet.has(p)) return { isDir: true, isSymlink: false, size: 4096 };
      if (fileMap.has(p)) return { isDir: false, isSymlink: false, size: fileMap.get(p) };
      throw new Error('ENOENT');
    },
    unlink: (p) => {
      if (!fileMap.delete(p) && !linkMap.delete(p)) throw new Error('ENOENT');
      removed.push(p);
    },
    rmdir: (p) => {
      if (childrenOf(p).length) throw new Error('ENOTEMPTY');
      if (!dirSet.delete(p)) throw new Error('ENOENT');
      removed.push(p + '/');
    },
    exec: async (file, args) => {
      const target = args[args.length - 1];
      if (!exists(target)) { const e = new Error('no such'); e.stdout = ''; throw e; }
      return { stdout: sizeUnder(target) + '\t' + target + '\n' };
    },
    now: () => '2026-10-19T12:00:00.000Z',
  };
  return deps;
}

test('getCleanables mede cada alvo e marca os ausentes', async () => {
  const deps = fakeFs({
    dirs: [THUMBS, PKGS],
    files: { [THUMBS + '/a.jpg']: 2 * 1024 * 1024, [PKGS + '/x.zip']: 1024 * 1024 },
  });
  const res = await clean.getCleanables(deps);
  const byKey = {};
  res.targets.forEach((t) => { byKey[t.key] = t; });
  assert.strictEqual(byKey.thumbnails.exists, true);
  assert.ok(byKey.thumbnails.sizeK >= 2048);
  assert.strictEqual(byKey.packages.exists, true);
  assert.strictEqual(byKey.temp.exists, false);
  assert.strictEqual(byKey.temp.sizeK, 0);
  assert.strictEqual(res.partial, false);
});

test('clean apaga o conteúdo dos alvos e conta os bytes liberados', async () => {
  const deps = fakeFs({
    dirs: [THUMBS, THUMBS + '/sub', PKGS],
    files: {
      [THUMBS + '/a.jpg']: 1024 * 1024,
      [THUMBS + '/sub/b.jpg']: 512 * 1024,
      [PKGS + '/x.zip']: 2 * 1024 * 1024,
    },
  });
  const res = await clean.clean(deps, { keys: ['thumbnails', 'packages'] });
  assert.strictEqual(res.freedK, 1024 + 512 + 2048);
  assert.strictEqual(res.targets.thumbnails, 1024 + 512);
  assert.strictEqual(res.targets.packages, 2048);
  // As pastas-raiz permanecem; o conteúdo some.
  assert.ok(deps.isDir(THUMBS));
  assert.ok(deps.isDir(PKGS));
  assert.strictEqual(deps.readdir(THUMBS).length, 0);
  assert.ok(deps.removed.includes(THUMBS + '/sub/'));
});

test('clean não segue symlink: remove o link, não o alvo externo', async () => {
  const deps = fakeFs({
    dirs: [THUMBS],
    files: { '/etc/importante': 9999 },
    symlinks: { [THUMBS + '/fuga']: '/etc' },
  });
  const res = await clean.clean(deps, { keys: ['thumbnails'] });
  assert.strictEqual(res.freedK, 0); // symlink não conta bytes
  assert.ok(deps.removed.includes(THUMBS + '/fuga'));
  assert.strictEqual(deps.lstat('/etc/importante').size, 9999); // intacto
});

test('clean recusa se o alvo virou um symlink para fora do cache', async () => {
  const deps = fakeFs({ dirs: [THUMBS], realpaths: { [THUMBS]: '/media/developer/outro' } });
  await assert.rejects(clean.clean(deps, { keys: ['thumbnails'] }), InputError);
  assert.strictEqual(deps.removed.length, 0);
});

test('clean valida as chaves e ignora alvo ausente', async () => {
  const deps = fakeFs({ dirs: [THUMBS] });
  for (const keys of [undefined, [], 'thumbnails', ['desconhecida'], ['thumbnails', 42], ['a', 'b', 'c', 'd']]) {
    await assert.rejects(clean.clean(deps, { keys }), InputError, JSON.stringify(keys));
  }
  // temp não existe: limpeza não falha, libera 0.
  const res = await clean.clean(deps, { keys: ['temp'] });
  assert.deepStrictEqual(res, { freedK: 0, targets: { temp: 0 }, partial: false });
});

test('clean marca parcial quando um arquivo não pode ser apagado', async () => {
  const deps = fakeFs({ dirs: [TEMP], files: { [TEMP + '/kodi.log']: 1024 * 1024, [TEMP + '/travado']: 2048 } });
  const realUnlink = deps.unlink;
  deps.unlink = (p) => { if (p.endsWith('/travado')) throw new Error('EBUSY'); realUnlink(p); };
  const res = await clean.clean(deps, { keys: ['temp'] });
  assert.strictEqual(res.partial, true);
  assert.strictEqual(res.targets.temp, 1024); // só o log entrou na conta
});
