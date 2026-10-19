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

test('serviço não usa shell, rede nem escrita em disco', () => {
  check(sources(path.join(ROOT, 'service'), '.js'), [
    [/\bexec\s*\(\s*['"`]|execSync|spawnSync|shell\s*:\s*true|require\(['"]child_process['"]\)\.exec\b/, 'shell'],
    [/\beval\s*\(|new Function\s*\(/, 'execução de texto'],
    [/require\(['"](https?|net|dgram|tls)['"]\)/, 'rede'],
    [/writeFile|appendFile|unlink|rmdir|\brm\(|rmSync|mkdir|rename|chmod|chown|copyFile|createWriteStream/, 'escrita em disco'],
  ]);
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
