// Fluxo de telas e navegação pelo controle remoto.
// Abrir uma pasta ou a limpeza faz history.pushState; o botão Voltar do webOS dispara history.back().
(function () {
  'use strict';

  var KEY = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, RED: 403, F5: 116, R: 82 };
  var view = document.getElementById('view');
  var updated = document.getElementById('updated');
  var requestId = 0;
  var lastFocus = {};

  function state() {
    return history.state || {};
  }

  function focusKey() {
    var st = state();
    return st.clean ? 'clean' : (st.path || '');
  }

  function focusables() {
    return Array.prototype.slice.call(view.querySelectorAll('[data-focus]'));
  }

  // No primeiro item, rola até o topo (revela os cards não focáveis acima dele);
  // no último, até o fim (passa do rodapé fixo); no meio, o mínimo para aparecer.
  function focusItem(node) {
    if (!node) return;
    node.focus();
    var items = focusables();
    if (node === items[0]) window.scrollTo(0, 0);
    else if (node === items[items.length - 1]) window.scrollTo(0, document.body.scrollHeight);
    else if (node.scrollIntoView) node.scrollIntoView({ block: 'nearest' });
  }

  function restoreFocus() {
    var key = lastFocus[focusKey()];
    var items = focusables();
    var match = items.filter(function (n) { return n.getAttribute('data-key') === key; })[0];
    focusItem(match || items[0]);
  }

  function rememberFocus() {
    var active = document.activeElement;
    if (active && active.hasAttribute && active.hasAttribute('data-key')) {
      lastFocus[focusKey()] = active.getAttribute('data-key');
    }
  }

  function setClock(data) {
    var time = Model.formatTime((data && data.generatedAt) || new Date().toISOString());
    updated.textContent = time ? 'Atualizado às ' + time : '';
  }

  function fail(retry) {
    return function (err) {
      UI.error(view, err.message, retry);
      focusItem(focusables()[0]);
    };
  }

  function loadBrowse(path) {
    var id = ++requestId;
    UI.loading(view, path ? 'Medindo pasta…' : 'Lendo armazenamento…');
    var request = path ? Bridge.call('getUsage', { path: path }) : Bridge.call('getOverview', {});
    request.then(function (data) {
      if (id !== requestId) return;
      if (path) UI.folder(view, Model.buildFolder(data), { open: open });
      else UI.overview(view, Model.buildOverview(data), { open: open, openClean: openClean });
      setClock(data);
      restoreFocus();
    }, function (err) {
      if (id !== requestId) return;
      fail(function () { loadBrowse(path); })(err);
    });
  }

  function loadClean() {
    var id = ++requestId;
    UI.loading(view, 'Calculando o cache…');
    Bridge.call('getCleanables', {}).then(function (data) {
      if (id !== requestId) return;
      UI.cleanConfirm(view, Model.buildCleanables(data), { confirm: runClean, cancel: goBack });
      restoreFocus();
    }, function (err) {
      if (id !== requestId) return;
      fail(loadClean)(err);
    });
  }

  function runClean(keys) {
    var id = ++requestId;
    UI.loading(view, 'Limpando…');
    Bridge.call('clean', { keys: keys }).then(function (data) {
      if (id !== requestId) return;
      UI.cleanResult(view, Model.buildCleanResult(data), { done: goBack });
      focusItem(focusables()[0]);
    }, function (err) {
      if (id !== requestId) return;
      fail(function () { runClean(keys); })(err);
    });
  }

  function render() {
    if (state().clean) loadClean();
    else loadBrowse(state().path || null);
  }

  function open(path) {
    rememberFocus();
    history.pushState({ path: path }, '');
    loadBrowse(path);
  }

  function openClean() {
    rememberFocus();
    history.pushState({ clean: true }, '');
    loadClean();
  }

  function goBack() {
    history.back();
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
        render();
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

  window.addEventListener('popstate', render);

  // webOS resume o app sem recarregar a página: ao voltar para o primeiro plano,
  // relê os dados para não mostrar números velhos.
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') render();
  });
  document.addEventListener('webOSRelaunch', render);

  history.replaceState({ path: null }, '');
  render();
})();
