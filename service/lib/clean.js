'use strict';

// Limpeza de cache. ÚNICO ponto do serviço que apaga arquivos.
// Regras de segurança:
// - A interface manda uma CHAVE ('thumbnails'|'packages'|'temp'), nunca um caminho.
//   O caminho real vem desta allow-list fixa, então não há travessia de diretório.
// - Antes de apagar, confere que o realpath do alvo é exatamente o esperado:
//   um symlink no lugar da pasta de cache faz a limpeza recusar, em vez de sair da área.
// - A deleção usa lstat e nunca entra em symlink: links são removidos como arquivo.
// - Mantém a pasta-raiz do alvo (o Kodi espera que ela exista) e apaga só o conteúdo.

const { InputError } = require('./parse');
const storage = require('./storage');

const KODI = '/media/developer/apps/usr/palm/applications/org.xbmc.kodi';
const CACHE_BASE = KODI + '/.kodi/';

const TARGETS = [
  { key: 'thumbnails', label: 'Miniaturas do Kodi', path: KODI + '/.kodi/userdata/Thumbnails' },
  { key: 'packages', label: 'Pacotes de add-ons (.zip)', path: KODI + '/.kodi/addons/packages' },
  { key: 'temp', label: 'Temporários e logs do Kodi', path: KODI + '/.kodi/temp' },
];
const BY_KEY = {};
TARGETS.forEach((t) => { BY_KEY[t.key] = t; });

// Trava contra loop ou volume absurdo de arquivos numa só chamada.
const MAX_ENTRIES = 200000;

function dirExists(deps, p) {
  try {
    return deps.isDir(p);
  } catch (err) {
    return false;
  }
}

async function getCleanables(deps) {
  const targets = [];
  let partial = false;
  for (const t of TARGETS) {
    if (!dirExists(deps, t.path)) {
      targets.push({ key: t.key, label: t.label, path: t.path, exists: false, sizeK: 0 });
      continue;
    }
    try {
      const m = await storage.measure(deps, t.path);
      partial = partial || m.partial;
      targets.push({ key: t.key, label: t.label, path: t.path, exists: true, sizeK: m.totalK || 0 });
    } catch (err) {
      partial = true;
      targets.push({ key: t.key, label: t.label, path: t.path, exists: true, sizeK: null });
    }
  }
  return { targets, partial };
}

// Apaga o conteúdo de `dir` (não a própria pasta). Retorna bytes liberados.
function clearContents(deps, dir, counter) {
  let freed = 0;
  let partial = false;
  let names;
  try {
    names = deps.readdir(dir);
  } catch (err) {
    return { freed: 0, partial: true };
  }
  for (const name of names) {
    if (name === '.' || name === '..') continue;
    if (++counter.n > MAX_ENTRIES) { partial = true; break; }
    const full = dir + '/' + name;
    let st;
    try {
      st = deps.lstat(full);
    } catch (err) {
      partial = true;
      continue;
    }
    if (st.isDir) {
      const r = clearContents(deps, full, counter);
      freed += r.freed;
      partial = partial || r.partial;
      try {
        deps.rmdir(full);
      } catch (err) {
        partial = true;
      }
    } else {
      // Arquivo comum ou symlink. Só conta bytes de arquivo comum.
      try {
        deps.unlink(full);
        if (!st.isSymlink) freed += st.size;
      } catch (err) {
        partial = true;
      }
    }
  }
  return { freed, partial };
}

async function clean(deps, params) {
  const keys = params && params.keys;
  if (!Array.isArray(keys) || keys.length === 0 || keys.length > TARGETS.length) {
    throw new InputError('Nada selecionado para limpar.');
  }
  const unique = [];
  for (const key of keys) {
    if (typeof key !== 'string' || !Object.prototype.hasOwnProperty.call(BY_KEY, key)) {
      throw new InputError('Item de limpeza inválido.');
    }
    if (unique.indexOf(key) === -1) unique.push(key);
  }

  let freed = 0;
  let partial = false;
  const perTarget = {};
  for (const key of unique) {
    const target = BY_KEY[key];
    if (!dirExists(deps, target.path)) { perTarget[key] = 0; continue; }

    let real;
    try {
      real = deps.realpath(target.path);
    } catch (err) {
      perTarget[key] = 0;
      continue;
    }
    // O alvo não pode ter sido trocado por um symlink para outro lugar.
    if (real !== target.path || !real.startsWith(CACHE_BASE)) {
      throw new InputError('Alvo de limpeza inesperado.');
    }

    const result = clearContents(deps, real, { n: 0 });
    perTarget[key] = Math.round(result.freed / 1024);
    freed += result.freed;
    partial = partial || result.partial;
  }

  return { freedK: Math.round(freed / 1024), targets: perTarget, partial };
}

module.exports = { getCleanables, clean, TARGETS, KODI, CACHE_BASE, MAX_ENTRIES };
