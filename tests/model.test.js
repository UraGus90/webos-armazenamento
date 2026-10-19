'use strict';

const test = require('node:test');
const assert = require('assert');
const M = require('../app/js/model');

const APPS = '/media/developer/apps/usr/palm/applications';

test('formatSize usa unidades legíveis com vírgula', () => {
  const cases = [
    [0, '0 KB'], [512, '512 KB'], [1024, '1,0 MB'], [5 * 1024, '5,0 MB'], [10 * 1024, '10 MB'],
    [320636, '313 MB'], [1024 * 1024 - 1, '1,00 GB'], [1417232, '1,35 GB'],
    [-1, '—'], [NaN, '—'], [Infinity, '—'], ['12', '—'], [null, '—'],
  ];
  for (const [input, expected] of cases) assert.strictEqual(M.formatSize(input), expected, String(input));
});

test('percent, formatPercent e level', () => {
  assert.strictEqual(M.percent(1, 0), 0);
  assert.strictEqual(M.percent(5, 4), 100);
  assert.strictEqual(M.percent('1', 2), 0);
  assert.strictEqual(M.formatPercent(0), '0%');
  assert.strictEqual(M.formatPercent(0.4), '<1%');
  assert.strictEqual(M.formatPercent(41.98), '42%');
  assert.deepStrictEqual([79.9, 80, 89.9, 90].map(M.level), ['ok', 'warn', 'warn', 'crit']);
});

test('formatTime e displayPath', () => {
  assert.strictEqual(M.formatTime('lixo'), '');
  assert.match(M.formatTime('2026-10-19T12:05:00Z'), /^\d\d:\d\d$/);
  assert.strictEqual(M.displayPath(APPS + '/org.xbmc.kodi/.kodi'), 'org.xbmc.kodi / .kodi');
  assert.strictEqual(M.displayPath(APPS), 'Apps de desenvolvedor');
  assert.strictEqual(M.displayPath(undefined), '');
});

test('buildOverview monta barra empilhada que fecha em 100%', () => {
  const model = M.buildOverview({
    areas: [
      { id: 'apps', totalK: 1433616, usedK: 594988, availK: 822244 },
      { id: 'tmp', totalK: 626008, usedK: 20196, availK: 605812 },
      { id: 'usb1', path: '/tmp/usb/sda/sda1', totalK: 100, usedK: 95, availK: 5 },
      { id: 'desconhecida', totalK: 1, usedK: 1, availK: 0 },
      { id: 'apps-ruim', totalK: 'x' },
    ],
    apps: [
      { id: 'org.xbmc.kodi', kind: 'app', title: 'Kodi', sizeK: 320636, path: APPS + '/org.xbmc.kodi' },
      { id: 'youtube.leanback.v4', kind: 'app', title: null, sizeK: 1820, path: APPS + '/youtube.leanback.v4' },
      { id: 'a', kind: 'app', sizeK: 10, path: '/a' },
      { id: 'b', kind: 'app', sizeK: 9, path: '/b' },
      { id: 'c.service', kind: 'service', sizeK: 8, path: '/c' },
      { id: 'ruim', sizeK: -5, path: '/r' },
    ],
    partial: true,
  });

  assert.strictEqual(model.main.totalK, 594988 + 822244);
  assert.strictEqual(Math.round(model.main.usedPct), 42);
  assert.strictEqual(model.main.level, 'ok');
  assert.deepStrictEqual(model.others.map((o) => [o.id, o.label, o.level]), [
    ['tmp', 'Memória temporária', 'ok'],
    ['usb1', 'Pendrive / HD USB', 'crit'],
  ]);
  assert.deepStrictEqual(model.apps.map((a) => a.title), ['Kodi', 'youtube.leanback.v4', 'a', 'b', 'c.service']);
  assert.strictEqual(model.apps[4].subtitle, 'Serviço · c.service');

  // Só o Kodi passa de 1%; os demais vão para "Outros apps".
  assert.deepStrictEqual(model.segments.map((s) => s.key), ['app0', 'apprest', 'system', 'free']);
  assert.deepStrictEqual(model.apps.map((a) => a.colorKey), ['app0', 'apprest', 'apprest', 'apprest', 'apprest']);
  assert.strictEqual(model.segments[1].sizeK, 1820 + 10 + 9 + 8);
  const system = model.segments.find((s) => s.key === 'system');
  assert.strictEqual(system.sizeK, 594988 - (320636 + 1820 + 10 + 9 + 8));
  const total = model.segments.reduce((s, x) => s + x.pct, 0);
  assert.ok(Math.abs(total - 100) < 1e-9, 'soma = ' + total);
  assert.strictEqual(model.partial, true);
});

test('buildOverview aguenta resposta vazia ou estranha', () => {
  for (const data of [undefined, null, {}, { areas: 'x', apps: 5 }]) {
    const model = M.buildOverview(data);
    assert.strictEqual(model.main, null);
    assert.deepStrictEqual(model.apps, []);
    assert.deepStrictEqual(model.segments, []);
  }
});

test('buildOverview dá cor própria a no máximo quatro apps', () => {
  const apps = [50, 40, 30, 20, 10].map((sizeK, i) => ({ id: 'a' + i, sizeK, path: '/a' + i }));
  const model = M.buildOverview({ areas: [{ id: 'apps', totalK: 1000, usedK: 500, availK: 500 }], apps });
  assert.deepStrictEqual(model.segments.map((s) => s.key), ['app0', 'app1', 'app2', 'app3', 'apprest', 'system', 'free']);
  assert.strictEqual(model.apps[4].colorKey, 'apprest');
});

test('buildOverview não deixa o segmento de sistema negativo', () => {
  const model = M.buildOverview({
    areas: [{ id: 'apps', totalK: 100, usedK: 10, availK: 90 }],
    apps: [{ id: 'x', sizeK: 50, path: '/x' }],
  });
  assert.strictEqual(model.segments.find((s) => s.key === 'system').sizeK, 0);
});

test('buildFolder calcula porcentagens, dicas e itens ocultos', () => {
  const kodi = APPS + '/org.xbmc.kodi/.kodi';
  const model = M.buildFolder({
    path: kodi,
    totalK: 1000,
    children: [
      { name: 'userdata', sizeK: 600, isDir: true },
      { name: 'temp', sizeK: 300, isDir: 'sim' },
      { name: 42, sizeK: 1 },
    ],
    hiddenCount: 3,
    hiddenK: 100,
  });
  assert.strictEqual(model.title, 'org.xbmc.kodi / .kodi');
  assert.deepStrictEqual(model.items.map((i) => [i.name, i.isDir, i.pct]), [
    ['userdata', true, 60], ['temp', false, 30], ['+ 3 itens menores', false, 10],
  ]);
  assert.match(model.items[1].hint, /temporários/);
  assert.strictEqual(model.items[2].path, null);
});

test('buildFolder usa a soma quando o du não trouxe o total', () => {
  const model = M.buildFolder({ path: '/p', totalK: null, children: [{ name: 'a', sizeK: 30 }, { name: 'b', sizeK: 10 }] });
  assert.strictEqual(model.totalK, 40);
  assert.strictEqual(model.items[0].pct, 75);
});
