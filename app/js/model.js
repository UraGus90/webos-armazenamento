// Regras de apresentação, sem DOM. Carregado como script na TV e como módulo nos testes.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Model = factory();
})(this, function () {
  'use strict';

  var KIB = 1024;
  var PALM = '/media/developer/apps/usr/palm/';
  var SEGMENT_APPS = 4;

  var AREA_INFO = {
    apps: { label: 'Espaço para apps', note: 'Apps instalados, dados dos apps e atualizações.' },
    prefs: { label: 'Partição de configurações', note: 'Usada pelo sistema. Somente leitura.' },
    tmp: { label: 'Memória temporária', note: 'Fica na RAM e é apagada quando a TV desliga.' }
  };

  var HINTS = [
    { suffix: '/.kodi/addons/packages', text: 'Cópias .zip de add-ons já instalados. O Kodi não precisa delas para funcionar.' },
    { suffix: '/.kodi/userdata/Thumbnails', text: 'Miniaturas em cache. O Kodi recria quando precisar.' },
    { suffix: '/.kodi/temp', text: 'Arquivos temporários e logs do Kodi.' },
    { suffix: '/.kodi/userdata/Database', text: 'Bibliotecas e configurações do Kodi. Não apague.' }
  ];

  function isSize(n) {
    return typeof n === 'number' && isFinite(n) && n >= 0;
  }

  function formatNumber(value, decimals) {
    return value.toFixed(decimals).replace('.', ',');
  }

  function formatSize(kib) {
    if (!isSize(kib)) return '—';
    if (kib < KIB) return formatNumber(kib, 0) + ' KB';
    var mib = kib / KIB;
    if (mib < 9.95) return formatNumber(mib, 1) + ' MB';
    if (mib < 1023.5) return formatNumber(mib, 0) + ' MB';
    return formatNumber(mib / KIB, 2) + ' GB';
  }

  function percent(part, total) {
    if (!isSize(part) || !isSize(total) || total === 0) return 0;
    return Math.min(100, (part / total) * 100);
  }

  function formatPercent(p) {
    if (p > 0 && p < 1) return '<1%';
    return Math.round(p) + '%';
  }

  function level(usedPct) {
    if (usedPct >= 90) return 'crit';
    if (usedPct >= 80) return 'warn';
    return 'ok';
  }

  function formatTime(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function hintFor(path) {
    for (var i = 0; i < HINTS.length; i++) {
      var s = HINTS[i].suffix;
      if (typeof path === 'string' && path.slice(-s.length) === s) return HINTS[i].text;
    }
    return null;
  }

  // "/media/developer/apps/usr/palm/applications/org.xbmc.kodi/.kodi" -> "org.xbmc.kodi / .kodi"
  function displayPath(path) {
    if (typeof path !== 'string') return '';
    var rest = path.indexOf(PALM) === 0 ? path.slice(PALM.length) : path;
    var parts = rest.split('/').filter(Boolean);
    if (parts[0] === 'applications' || parts[0] === 'services') parts.shift();
    return parts.length ? parts.join(' / ') : 'Apps de desenvolvedor';
  }

  function isArea(a) {
    return a && typeof a.id === 'string' && isSize(a.totalK) && isSize(a.usedK) && isSize(a.availK);
  }

  function isApp(a) {
    return a && typeof a.id === 'string' && typeof a.path === 'string' && isSize(a.sizeK);
  }

  function areaView(a) {
    var info = AREA_INFO[a.id] || (/^usb\d+$/.test(a.id) ? { label: 'Pendrive / HD USB', note: a.path } : null);
    if (!info) return null;
    // Igual ao df: reserva do ext4 fica de fora da conta de uso.
    var usable = a.usedK + a.availK;
    var usedPct = percent(a.usedK, usable);
    return {
      id: a.id, label: info.label, note: info.note,
      totalK: usable, usedK: a.usedK, availK: a.availK,
      usedPct: usedPct, level: level(usedPct)
    };
  }

  // Apps com menos de 1% do espaço não ganham cor própria: vão para "Outros apps".
  function buildSegments(main, apps) {
    var segments = [];
    var devK = 0;
    var restK = 0;
    apps.forEach(function (a) {
      devK += a.sizeK;
      if (segments.length < SEGMENT_APPS && a.pct >= 1) {
        a.colorKey = 'app' + segments.length;
        segments.push({ key: a.colorKey, label: a.title, sizeK: a.sizeK });
      } else {
        restK += a.sizeK;
      }
    });
    if (restK > 0) segments.push({ key: 'apprest', label: 'Outros apps de desenvolvedor', sizeK: restK });
    segments.push({ key: 'system', label: 'Sistema, apps da loja e dados', sizeK: Math.max(0, main.usedK - devK) });
    segments.push({ key: 'free', label: 'Livre', sizeK: main.availK });
    segments.forEach(function (s) { s.pct = percent(s.sizeK, main.totalK); });
    return segments;
  }

  function buildOverview(data) {
    var areas = data && Array.isArray(data.areas) ? data.areas : [];
    var rawApps = data && Array.isArray(data.apps) ? data.apps : [];
    var main = null;
    var others = [];
    areas.filter(isArea).forEach(function (a) {
      var v = areaView(a);
      if (!v) return;
      if (v.id === 'apps') main = v;
      else others.push(v);
    });
    var apps = rawApps.filter(isApp).map(function (a) {
      return {
        id: a.id,
        title: a.title || a.id,
        subtitle: a.kind === 'service' ? 'Serviço · ' + a.id : a.id,
        sizeK: a.sizeK,
        path: a.path,
        pct: main ? percent(a.sizeK, main.totalK) : 0,
        colorKey: 'apprest'
      };
    });
    return {
      main: main,
      segments: main ? buildSegments(main, apps) : [],
      apps: apps,
      others: others,
      partial: !!(data && data.partial),
      generatedAt: data && data.generatedAt
    };
  }

  function buildFolder(data) {
    var children = data && Array.isArray(data.children) ? data.children : [];
    var valid = children.filter(function (c) { return c && typeof c.name === 'string' && isSize(c.sizeK); });
    var sum = valid.reduce(function (s, c) { return s + c.sizeK; }, 0) + (isSize(data && data.hiddenK) ? data.hiddenK : 0);
    var totalK = isSize(data && data.totalK) ? data.totalK : sum;
    var items = valid.map(function (c) {
      var path = data.path + '/' + c.name;
      return { name: c.name, sizeK: c.sizeK, isDir: c.isDir === true, pct: percent(c.sizeK, totalK), path: path, hint: hintFor(path) };
    });
    if (data && data.hiddenCount > 0) {
      items.push({
        name: '+ ' + data.hiddenCount + ' itens menores', sizeK: data.hiddenK, isDir: false,
        pct: percent(data.hiddenK, totalK), path: null, hint: null, summary: true
      });
    }
    return {
      path: data && data.path,
      title: displayPath(data && data.path),
      totalK: totalK,
      items: items,
      hint: hintFor(data && data.path),
      partial: !!(data && data.partial)
    };
  }

  return {
    formatSize: formatSize, percent: percent, formatPercent: formatPercent, level: level,
    formatTime: formatTime, hintFor: hintFor, displayPath: displayPath,
    buildOverview: buildOverview, buildFolder: buildFolder
  };
});
