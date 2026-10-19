// Fluxo de telas e navegação pelo controle remoto.
// Abrir uma pasta faz history.pushState; o botão Voltar do webOS dispara history.back().
(function () {
  'use strict';

  var KEY = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, RED: 403, F5: 116, R: 82 };
  var view = document.getElementById('view');
  var updated = document.getElementById('updated');
  var requestId = 0;
  var lastFocus = {};

  function currentPath() {
    return (history.state && history.state.path) || null;
  }

  function focusables() {
    return Array.prototype.slice.call(view.querySelectorAll('[data-focus]'));
  }

  function focusItem(node) {
    if (!node) return;
    node.focus();
    if (node.scrollIntoView) node.scrollIntoView({ block: 'nearest' });
  }

  function restoreFocus() {
    var key = lastFocus[currentPath() || ''];
    var items = focusables();
    var match = items.filter(function (n) { return n.getAttribute('data-key') === key; })[0];
    focusItem(match || items[0]);
  }

  function rememberFocus() {
    var active = document.activeElement;
    if (active && active.hasAttribute && active.hasAttribute('data-key')) {
      lastFocus[currentPath() || ''] = active.getAttribute('data-key');
    }
  }

  function load(path) {
    var id = ++requestId;
    UI.loading(view, path ? 'Medindo pasta…' : 'Lendo armazenamento…');
    var request = path ? Bridge.call('getUsage', { path: path }) : Bridge.call('getOverview', {});
    request.then(function (data) {
      if (id !== requestId) return;
      if (path) UI.folder(view, Model.buildFolder(data), { open: open });
      else UI.overview(view, Model.buildOverview(data), { open: open });
      var time = Model.formatTime(data.generatedAt || new Date().toISOString());
      updated.textContent = time ? 'Atualizado às ' + time : '';
      restoreFocus();
    }, function (err) {
      if (id !== requestId) return;
      UI.error(view, err.message, function () { load(path); });
      restoreFocus();
    });
  }

  function open(path) {
    rememberFocus();
    history.pushState({ path: path }, '');
    load(path);
  }

  function move(step) {
    var items = focusables();
    if (!items.length) return;
    var index = items.indexOf(document.activeElement);
    var next = index < 0 ? 0 : Math.max(0, Math.min(items.length - 1, index + step));
    focusItem(items[next]);
  }

  document.addEventListener('keydown', function (e) {
    switch (e.keyCode) {
      case KEY.UP:
      case KEY.LEFT:
        move(-1);
        break;
      case KEY.DOWN:
      case KEY.RIGHT:
        move(1);
        break;
      case KEY.RED:
      case KEY.F5:
      case KEY.R:
        rememberFocus();
        load(currentPath());
        break;
      default:
        return;
    }
    e.preventDefault();
  });

  // Magic Remote: o ponteiro também move o foco.
  view.addEventListener('mouseover', function (e) {
    var target = e.target.closest && e.target.closest('[data-focus]');
    if (target && target !== document.activeElement) target.focus();
  });

  window.addEventListener('popstate', function () {
    load(currentPath());
  });

  history.replaceState({ path: null }, '');
  load(null);
})();
