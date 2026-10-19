'use strict';

// Gera dist/prototype/: a mesma interface do app, rodando no navegador do PC
// com um serviço simulado que responde com dados capturados da TV.

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const appDir = path.join(root, 'app');
const outDir = path.join(root, 'dist', 'prototype');
const snapshotFile = process.argv[2] || path.join(root, 'tests', 'fixtures', 'tv-snapshot.json');

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const from = path.join(src, name);
    const to = path.join(dst, name);
    if (fs.statSync(from).isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

const snapshot = JSON.parse(fs.readFileSync(snapshotFile, 'utf8'));
fs.rmSync(outDir, { recursive: true, force: true });
copyDir(appDir, outDir);

// Dados como JSON dentro de um .js externo: a CSP do app proíbe script inline.
const mock = `// Gerado por tools/build-prototype.js. Não vai para o .ipk.
(function (root) {
  'use strict';
  var snapshot = ${JSON.stringify(snapshot)};
  function delay(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  root.__mockService = function (method, params) {
    return delay(400).then(function () {
      if (method === 'getOverview') {
        return Object.assign({ returnValue: true }, snapshot.overview, { generatedAt: new Date().toISOString() });
      }
      if (method === 'getUsage') {
        var folder = snapshot.folders[params && params.path];
        if (folder) return Object.assign({ returnValue: true }, folder);
        throw new Error('Esta pasta não foi capturada para o protótipo.');
      }
      throw new Error('Método desconhecido.');
    });
  };
})(this);
`;
fs.writeFileSync(path.join(outDir, 'mock-service.js'), mock);

// index.html#pasta=<caminho> abre direto uma pasta (útil para conferir telas internas).
const deepLink = `// Gerado por tools/build-prototype.js. Não vai para o .ipk.
(function () {
  var prefix = '#pasta=';
  if (location.hash.indexOf(prefix) !== 0) return;
  var p = decodeURIComponent(location.hash.slice(prefix.length));
  history.pushState({ path: p }, '');
  window.dispatchEvent(new PopStateEvent('popstate', { state: { path: p } }));
})();
`;
fs.writeFileSync(path.join(outDir, 'deep-link.js'), deepLink);

const indexFile = path.join(outDir, 'index.html');
let html = fs.readFileSync(indexFile, 'utf8');
const bridgeTag = '<script src="js/bridge.js"></script>';
const mainTag = '<script src="js/main.js"></script>';
if (!html.includes(bridgeTag) || !html.includes(mainTag)) throw new Error('index.html sem os scripts esperados.');
html = html.replace(bridgeTag, '<script src="mock-service.js"></script>\n  ' + bridgeTag);
html = html.replace(mainTag, mainTag + '\n  <script src="deep-link.js"></script>');
fs.writeFileSync(indexFile, html);

console.log('Protótipo gerado: ' + indexFile);
