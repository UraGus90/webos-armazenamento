// Renderização. Todo texto entra por textContent: nomes de arquivos nunca viram HTML.
(function (root) {
  'use strict';

  var M = root.Model;

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function bar(pct, className) {
    var outer = el('div', 'bar');
    var fill = el('div', 'bar-fill ' + (className || ''));
    fill.style.width = pct.toFixed(2) + '%';
    outer.appendChild(fill);
    return outer;
  }

  function row(item, opts) {
    var node = el(opts.focusable ? 'button' : 'div', 'row' + (opts.extraClass ? ' ' + opts.extraClass : ''));
    if (opts.focusable) {
      node.type = 'button';
      node.setAttribute('data-focus', '');
      if (opts.key) node.setAttribute('data-key', opts.key);
      if (opts.onSelect) node.addEventListener('click', opts.onSelect);
    }
    var head = el('div', 'row-head');
    var names = el('div', 'row-names');
    names.appendChild(el('span', 'row-title', item.title));
    if (item.subtitle) names.appendChild(el('span', 'row-sub', item.subtitle));
    head.appendChild(names);
    var size = el('div', 'row-size');
    size.appendChild(el('span', 'size', M.formatSize(item.sizeK)));
    size.appendChild(el('span', 'pct', item.pctText));
    head.appendChild(size);
    if (opts.chevron) head.appendChild(el('span', 'chevron', '›'));
    node.appendChild(head);
    node.appendChild(bar(item.pct, opts.barClass));
    if (item.hint) node.appendChild(el('p', 'hint', item.hint));
    return node;
  }

  function section(title, note) {
    var s = el('section', 'section');
    s.appendChild(el('h2', null, title));
    if (note) s.appendChild(el('p', 'note', note));
    return s;
  }

  function partialNotice(parent) {
    parent.appendChild(el('p', 'notice', 'Algumas pastas não puderam ser lidas; os totais podem estar um pouco abaixo do real.'));
  }

  function hero(main, segments) {
    var card = el('section', 'hero hero-' + main.level);
    card.appendChild(el('h2', null, main.label));
    var big = el('p', 'hero-free');
    big.appendChild(el('span', 'hero-num', M.formatSize(main.availK)));
    big.appendChild(el('span', 'hero-unit', ' livres'));
    card.appendChild(big);
    card.appendChild(el('p', 'hero-sub',
      M.formatSize(main.usedK) + ' usados de ' + M.formatSize(main.totalK) + ' · ' + M.formatPercent(main.usedPct) + ' ocupado'));

    var stack = el('div', 'stack');
    segments.forEach(function (s) {
      var part = el('div', 'seg seg-' + s.key);
      part.style.width = s.pct.toFixed(3) + '%';
      stack.appendChild(part);
    });
    card.appendChild(stack);

    var legend = el('ul', 'legend');
    segments.forEach(function (s) {
      var li = el('li');
      li.appendChild(el('span', 'dot seg-' + s.key));
      li.appendChild(el('span', 'legend-label', s.label));
      li.appendChild(el('span', 'legend-size', M.formatSize(s.sizeK)));
      legend.appendChild(li);
    });
    card.appendChild(legend);
    card.appendChild(el('p', 'note', main.note));
    return card;
  }

  function overview(view, model, handlers) {
    clear(view);
    if (!model.main) {
      view.appendChild(el('p', 'notice', 'Não foi possível ler o espaço para apps.'));
    } else {
      view.appendChild(hero(model.main, model.segments));
    }

    var appsSection = section('Apps de desenvolvedor',
      'Apps da LG Content Store não podem ser medidos um a um sem root; estão somados em “Sistema, apps da loja e dados”.');
    if (!model.apps.length) appsSection.appendChild(el('p', 'note', 'Nenhum app de desenvolvedor instalado.'));
    model.apps.forEach(function (a) {
      appsSection.appendChild(row(
        { title: a.title, subtitle: a.subtitle, sizeK: a.sizeK, pct: a.pct, pctText: M.formatPercent(a.pct) },
        {
          focusable: true, key: a.path, chevron: true, barClass: 'seg-' + a.colorKey,
          onSelect: function () { handlers.open(a.path); }
        }
      ));
    });
    view.appendChild(appsSection);

    if (model.others.length) {
      var othersSection = section('Outras áreas');
      model.others.forEach(function (o) {
        othersSection.appendChild(row(
          { title: o.label, subtitle: o.note, sizeK: o.usedK, pct: o.usedPct,
            pctText: 'de ' + M.formatSize(o.totalK) },
          { focusable: true, key: 'area:' + o.id, barClass: 'level-' + o.level, extraClass: 'static' }
        ));
      });
      view.appendChild(othersSection);
    }
    if (model.partial) partialNotice(view);
  }

  function folder(view, model, handlers) {
    clear(view);
    var head = el('section', 'folder-head');
    head.appendChild(el('h2', null, model.title));
    head.appendChild(el('p', 'hero-sub', 'Total: ' + M.formatSize(model.totalK)));
    if (model.hint) head.appendChild(el('p', 'hint', model.hint));
    view.appendChild(head);

    var list = el('section', 'section');
    if (!model.items.length) list.appendChild(el('p', 'note', 'Pasta vazia.'));
    model.items.forEach(function (item) {
      list.appendChild(row(
        { title: item.name + (item.isDir ? '/' : ''), sizeK: item.sizeK, pct: item.pct,
          pctText: M.formatPercent(item.pct), hint: item.hint },
        {
          focusable: true, key: item.path || item.name, chevron: item.isDir,
          barClass: item.isDir ? 'seg-app0' : 'seg-system',
          extraClass: item.isDir ? null : 'static',
          onSelect: item.isDir ? function () { handlers.open(item.path); } : null
        }
      ));
    });
    view.appendChild(list);
    if (model.partial) partialNotice(view);
  }

  function loading(view, text) {
    clear(view);
    var box = el('div', 'state');
    box.appendChild(el('div', 'spinner'));
    box.appendChild(el('p', null, text));
    view.appendChild(box);
  }

  function error(view, message, onRetry) {
    clear(view);
    var box = el('div', 'state');
    box.appendChild(el('p', 'notice', message));
    var retry = el('button', 'retry', 'Tentar de novo');
    retry.type = 'button';
    retry.setAttribute('data-focus', '');
    retry.addEventListener('click', onRetry);
    box.appendChild(retry);
    view.appendChild(box);
  }

  root.UI = { overview: overview, folder: folder, loading: loading, error: error };
})(this);
