'use strict';

// Roda NA TV (Node 16), com a mesma biblioteca do serviço:
//   node tools/capture-snapshot.js > snapshot.json
// Serve como teste de integração com o df/du reais e alimenta o protótipo do PC.

const storage = require('../service/lib/storage');
const { createDeps } = require('../service/lib/deps');

const MAX_FOLDERS = 80;
const MAX_DEPTH = 3;
const MIN_SIZE_K = 1024;

async function main() {
  const deps = createDeps();
  const started = Date.now();
  const overview = await storage.getOverview(deps);
  const folders = {};
  const queue = overview.apps.map((a) => ({ path: a.path, depth: 0 }));
  while (queue.length && Object.keys(folders).length < MAX_FOLDERS) {
    const { path, depth } = queue.shift();
    const usage = await storage.getUsage(deps, { path });
    folders[usage.path] = usage;
    if (depth >= MAX_DEPTH) continue;
    usage.children
      .filter((c) => c.isDir && c.sizeK >= MIN_SIZE_K)
      .slice(0, 8)
      .forEach((c) => queue.push({ path: usage.path + '/' + c.name, depth: depth + 1 }));
  }
  process.stdout.write(JSON.stringify({ overview, folders, elapsedMs: Date.now() - started }, null, 1) + '\n');
}

main().catch((err) => {
  console.error(err && err.stack);
  process.exit(1);
});
