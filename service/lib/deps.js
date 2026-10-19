'use strict';

// E/S real usada na TV. Sem shell: binários com caminho absoluto e argumentos em lista.

const fs = require('fs');
const { execFile } = require('child_process');

const EXEC_OPTIONS = {
  timeout: 20000,
  maxBuffer: 1024 * 1024,
  env: { PATH: '/bin:/usr/bin', LC_ALL: 'C' },
};

function exec(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, EXEC_OPTIONS, (err, stdout) => {
      if (err) {
        err.stdout = stdout;
        reject(err);
      } else {
        resolve({ stdout });
      }
    });
  });
}

function createDeps() {
  return {
    exec,
    readFile: (p) => fs.readFileSync(p, 'utf8'),
    statSize: (p) => fs.statSync(p).size,
    realpath: (p) => fs.realpathSync(p),
    isDir: (p) => fs.lstatSync(p).isDirectory(),
    // Usados só pela limpeza de cache (clean.js).
    readdir: (p) => fs.readdirSync(p),
    lstat: (p) => {
      const s = fs.lstatSync(p);
      return { isDir: s.isDirectory(), isSymlink: s.isSymbolicLink(), size: s.size };
    },
    unlink: (p) => fs.unlinkSync(p),
    rmdir: (p) => fs.rmdirSync(p),
    now: () => new Date().toISOString(),
  };
}

module.exports = { createDeps, EXEC_OPTIONS };
