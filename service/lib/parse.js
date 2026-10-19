'use strict';

// Funções puras: interpretam a saída do busybox e validam caminhos.
// Precisam rodar no Node 16 da TV.

const posix = require('path').posix;

const NAME_RE = /^[A-Za-z0-9._-]{1,128}$/;
const MAX_PATH_LENGTH = 512;

class InputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InputError';
  }
}

function toSize(text) {
  if (!/^\d{1,15}$/.test(text)) return null;
  return Number(text);
}

// `df -P -k`: cabeçalho + uma linha por sistema de arquivos.
function parseDf(stdout) {
  const rows = [];
  for (const line of String(stdout).split('\n').slice(1)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 6) continue;
    const sizes = cols.slice(1, 4).map(toSize);
    if (sizes.includes(null)) continue;
    rows.push({
      device: cols[0],
      totalK: sizes[0],
      usedK: sizes[1],
      availK: sizes[2],
      mount: cols.slice(5).join(' '),
    });
  }
  return rows;
}

// `du -k [-a] -d 1 <root>`: total de root e seus filhos diretos, do maior para o menor.
function parseDu(stdout, root) {
  let totalK = null;
  const children = [];
  for (const line of String(stdout).split('\n')) {
    const tab = line.indexOf('\t');
    if (tab < 1) continue;
    const sizeK = toSize(line.slice(0, tab));
    if (sizeK === null) continue;
    const entry = line.slice(tab + 1);
    if (entry === root) totalK = sizeK;
    else if (posix.dirname(entry) === root) children.push({ name: posix.basename(entry), sizeK });
  }
  children.sort((a, b) => b.sizeK - a.sizeK || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { totalK, children };
}

function isInside(p, roots) {
  return roots.some((root) => p === root || p.startsWith(root + '/'));
}

// Normaliza o caminho pedido pela interface e exige que fique dentro das raízes permitidas.
// A verificação de links simbólicos (realpath) fica com quem chama, que tem acesso ao disco.
function resolveAllowed(requested, roots) {
  if (typeof requested !== 'string' || requested.length === 0 || requested.length > MAX_PATH_LENGTH) {
    throw new InputError('Caminho inválido.');
  }
  if (requested.includes('\0') || requested[0] !== '/') throw new InputError('Caminho inválido.');
  const normalized = posix.normalize(requested).replace(/\/+$/, '');
  if (!isInside(normalized, roots)) throw new InputError('Caminho fora da área permitida.');
  return normalized;
}

// /proc/mounts codifica espaço, tab, \n e \ em octal (\040 etc.).
function decodeMountField(field) {
  return field.replace(/\\([0-7]{3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)));
}

function parseUsbMounts(procMounts, usbRoot) {
  const found = new Set();
  for (const line of String(procMounts).split('\n')) {
    const cols = line.split(' ');
    if (cols.length < 3) continue;
    const mount = decodeMountField(cols[1]);
    if (mount.startsWith(usbRoot + '/') && !/[\n\0]/.test(mount)) found.add(mount);
  }
  return Array.from(found).sort();
}

module.exports = { NAME_RE, InputError, parseDf, parseDu, isInside, resolveAllowed, parseUsbMounts };
