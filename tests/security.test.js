'use strict';

// Verificações estáticas das regras de segurança do projeto.

const test = require('node:test');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function sources(dir, ext) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) out.push(...sources(full, ext));
    else if (name.endsWith(ext)) out.push(full);
  }
  return out;
}

function check(files, rules) {
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const [pattern, why] of rules) {
      assert.ok(!pattern.test(text), path.relative(ROOT, file) + ': ' + why);
    }
  }
}

test('interface não injeta HTML nem executa texto como código', () => {
  check(sources(path.join(ROOT, 'app'), '.js'), [
    [/\.innerHTML\b|\.outerHTML\b|insertAdjacentHTML|document\.write/, 'injeção de HTML'],
    [/\beval\s*\(|new Function\s*\(|setTimeout\s*\(\s*['"`]|setInterval\s*\(\s*['"`]/, 'execução de texto'],
    [/https?:\/\/|XMLHttpRequest|fetch\s*\(|WebSocket/, 'acesso à rede'],
    [/localStorage|sessionStorage|indexedDB|document\.cookie/, 'armazenamento persistente'],
  ]);
});

test('serviço não usa shell, rede nem cria/sobrescreve arquivos', () => {
  check(sources(path.join(ROOT, 'service'), '.js'), [
    [/\bexec\s*\(\s*['"`]|execSync|spawnSync|shell\s*:\s*true|require\(['"]child_process['"]\)\.exec\b/, 'shell'],
    [/\beval\s*\(|new Function\s*\(/, 'execução de texto'],
    [/require\(['"](https?|net|dgram|tls)['"]\)/, 'rede'],
    // Não escrevemos nem criamos arquivos; a única mutação permitida é apagar cache (unlink/rmdir), restrita a deps.js e clean.js.
    [/writeFile|appendFile|mkdir|rename|chmod|chown|copyFile|createWriteStream|truncate/, 'criação/escrita de arquivo'],
  ]);
});

test('apagar arquivos (unlink/rmdir) só aparece em deps.js e clean.js', () => {
  const allowed = new Set(['service/lib/deps.js', 'service/lib/clean.js']);
  for (const file of sources(path.join(ROOT, 'service'), '.js')) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    if (allowed.has(rel)) continue;
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /unlink|rmdir|rmSync|\brm\b/, rel + ': deleção fora do módulo de limpeza');
  }
});

test('o módulo de limpeza confina os alvos ao cache do Kodi', () => {
  const text = fs.readFileSync(path.join(ROOT, 'service', 'lib', 'clean.js'), 'utf8');
  // Caminhos fixos; a interface manda chave, nunca caminho. Confere allow-list e checagem de realpath.
  assert.match(text, /org\.xbmc\.kodi/, 'alvos devem ser caminhos fixos do Kodi');
  assert.match(text, /realpath/, 'deve reconferir o realpath antes de apagar');
  assert.match(text, /startsWith\(CACHE_BASE\)/, 'deve exigir que o alvo fique dentro do cache');
  assert.doesNotMatch(text, /params\s*\.\s*path|params\[/, 'não deve usar caminho vindo da interface');
});

test('index.html tem CSP restritiva e nenhum script ou estilo inline', () => {
  const html = fs.readFileSync(path.join(ROOT, 'app', 'index.html'), 'utf8');
  const csp = (html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/) || [])[1];
  assert.ok(csp, 'CSP ausente');
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /script-src 'self'(;|$)/);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval|\*/);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/, 'script inline');
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i, 'handler inline');
  assert.doesNotMatch(html, /<style|\sstyle=/i, 'estilo inline');
});

test('appinfo.json não pede permissões', () => {
  const info = JSON.parse(fs.readFileSync(path.join(ROOT, 'app', 'appinfo.json'), 'utf8'));
  assert.strictEqual(info.requiredPermissions, undefined);
  assert.strictEqual(info.trustLevel, undefined);
});
