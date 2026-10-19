'use strict';

const test = require('node:test');
const assert = require('assert');
const { parseDf, parseDu, resolveAllowed, parseUsbMounts, InputError } = require('../service/lib/parse');

const APPS = '/media/developer/apps/usr/palm/applications';
const ROOTS = [APPS, '/media/developer/apps/usr/palm/services'];

test('parseDf lê a saída real da TV', () => {
  const out = [
    'Filesystem           1024-blocks    Used Available Capacity Mounted on',
    '/dev/mmcblk0p59        1433616    594988    822244  42% /media/cryptofs/apps/usr/palm/services/com.palmdts.devmode.service/binaries-armv71/opt/openssh',
    '',
  ].join('\n');
  assert.deepStrictEqual(parseDf(out), [{
    device: '/dev/mmcblk0p59', totalK: 1433616, usedK: 594988, availK: 822244,
    mount: '/media/cryptofs/apps/usr/palm/services/com.palmdts.devmode.service/binaries-armv71/opt/openssh',
  }]);
});

test('parseDf ignora linhas malformadas e preserva espaço no ponto de montagem', () => {
  const out = [
    'Filesystem 1024-blocks Used Available Capacity Mounted on',
    'lixo',
    '/dev/x - 10 20 1% /a',
    '/dev/y 100 40 60 40% /tmp/usb/sda/Meu Pendrive',
  ].join('\n');
  assert.deepStrictEqual(parseDf(out), [{ device: '/dev/y', totalK: 100, usedK: 40, availK: 60, mount: '/tmp/usb/sda/Meu Pendrive' }]);
  assert.deepStrictEqual(parseDf(''), []);
  assert.deepStrictEqual(parseDf(undefined), []);
});

test('parseDu devolve total e filhos diretos, do maior para o menor', () => {
  const root = APPS + '/org.xbmc.kodi';
  const out = [
    `46504\t${root}/lib`,
    `72480\t${root}/kodi-webos`,
    `12\t${root}/lib/sub`,
    `abc\t${root}/estranho`,
    'sem-tab',
    `20\t${root}/b`,
    `20\t${root}/a`,
    `320636\t${root}`,
  ].join('\n');
  assert.deepStrictEqual(parseDu(out, root), {
    totalK: 320636,
    children: [
      { name: 'kodi-webos', sizeK: 72480 },
      { name: 'lib', sizeK: 46504 },
      { name: 'a', sizeK: 20 },
      { name: 'b', sizeK: 20 },
    ],
  });
});

test('parseDu sem a linha da raiz deixa totalK nulo', () => {
  assert.strictEqual(parseDu(`5\t${APPS}/x`, APPS).totalK, null);
});

test('resolveAllowed aceita raízes e subpastas, normalizando', () => {
  assert.strictEqual(resolveAllowed(APPS, ROOTS), APPS);
  assert.strictEqual(resolveAllowed(APPS + '/', ROOTS), APPS);
  assert.strictEqual(resolveAllowed(APPS + '/./org.xbmc.kodi//addons/', ROOTS), APPS + '/org.xbmc.kodi/addons');
  assert.strictEqual(resolveAllowed(APPS + '/a/../b', ROOTS), APPS + '/b');
});

test('resolveAllowed recusa entradas fora da área ou malformadas', () => {
  const bad = [
    APPS + '/../../../../../etc',
    APPS + '/../services-evil',
    APPS + '-evil/x',
    '/media/developer',
    '/',
    'relativo/org.xbmc.kodi',
    '',
    APPS + '/x\0y',
    APPS + '/' + 'a'.repeat(600),
    null,
    undefined,
    42,
    {},
    [APPS],
  ];
  for (const value of bad) {
    assert.throws(() => resolveAllowed(value, ROOTS), InputError, 'deveria recusar: ' + String(value).slice(0, 60));
  }
});

test('parseUsbMounts acha só montagens abaixo de /tmp/usb e decodifica octal', () => {
  const mounts = [
    'tmpfs /tmp/usb tmpfs rw,relatime 0 0',
    '/dev/sda1 /tmp/usb/sda/sda1 vfat rw 0 0',
    '/dev/sdb1 /tmp/usb/sdb/Meu\\040HD exfat rw 0 0',
    '/dev/sda1 /tmp/usb/sda/sda1 vfat rw 0 0',
    '/dev/mmcblk0p59 /media/developer ext4 rw 0 0',
    'curta',
  ].join('\n');
  assert.deepStrictEqual(parseUsbMounts(mounts, '/tmp/usb'), ['/tmp/usb/sda/sda1', '/tmp/usb/sdb/Meu HD']);
});
