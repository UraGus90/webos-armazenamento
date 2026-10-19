'use strict';

const test = require('node:test');
const assert = require('assert');
const { createHandler } = require('../service/lib/handler');
const { InputError } = require('../service/lib/parse');

const APP_ID = 'org.local.armazenamento';

function message(sender, payload) {
  const msg = { sender, payload, responses: [] };
  msg.respond = (r) => msg.responses.push(r);
  return msg;
}

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

test('recusa chamador que não é o próprio app', async () => {
  let called = false;
  const handle = createHandler({ allowedSenders: [APP_ID], deps: {}, storage: { getOverview: async () => { called = true; } } });
  for (const sender of ['com.outro.app', 'com.webos.lunasendpub', '', undefined]) {
    const msg = message(sender, {});
    await handle('getOverview', msg);
    assert.strictEqual(msg.responses[0].errorCode, 'FORBIDDEN');
  }
  assert.strictEqual(called, false);
});

test('recusa método desconhecido, inclusive nomes de protótipo', async () => {
  const handle = createHandler({ allowedSenders: [APP_ID], deps: {}, storage: {} });
  for (const name of ['apagar', '__proto__', 'constructor', 'toString']) {
    const msg = message(APP_ID, {});
    await handle(name, msg);
    assert.strictEqual(msg.responses[0].errorCode, 'UNKNOWN_METHOD', name);
  }
});

test('responde sucesso com returnValue e repassa o payload', async () => {
  let received;
  const handle = createHandler({
    allowedSenders: [APP_ID],
    deps: { tag: 'deps' },
    storage: { getUsage: async (deps, payload) => { received = [deps.tag, payload]; return { totalK: 5 }; } },
  });
  const msg = message(APP_ID, { path: '/x' });
  await handle('getUsage', msg);
  assert.deepStrictEqual(msg.responses, [{ returnValue: true, totalK: 5 }]);
  assert.deepStrictEqual(received, ['deps', { path: '/x' }]);

  const bad = message(APP_ID, 'texto');
  await handle('getUsage', bad);
  assert.deepStrictEqual(received[1], {});
});

test('erro de entrada é explicado; erro interno não vaza detalhes', async () => {
  const logs = [];
  const handle = createHandler({
    allowedSenders: [APP_ID],
    deps: {},
    log: (t) => logs.push(t),
    storage: {
      getUsage: async () => { throw new InputError('Caminho inválido.'); },
      getOverview: async () => { throw new Error('/usr/bin/du: segredo interno'); },
    },
  });
  const a = message(APP_ID, {});
  await handle('getUsage', a);
  assert.deepStrictEqual(a.responses[0], { returnValue: false, errorCode: 'BAD_INPUT', errorText: 'Caminho inválido.' });

  const b = message(APP_ID, {});
  await handle('getOverview', b);
  assert.strictEqual(b.responses[0].errorCode, 'INTERNAL');
  assert.ok(!JSON.stringify(b.responses[0]).includes('segredo'));
  assert.deepStrictEqual(logs, ['getOverview: /usr/bin/du: segredo interno']);
});

test('executa um pedido por vez e recusa fila longa', async () => {
  const order = [];
  const gates = [deferred(), deferred()];
  let n = 0;
  const handle = createHandler({
    allowedSenders: [APP_ID],
    deps: {},
    maxPending: 2,
    storage: {
      getOverview: () => {
        const i = n++;
        order.push('início ' + i);
        return gates[i].promise.then(() => { order.push('fim ' + i); return {}; });
      },
    },
  });
  const m1 = message(APP_ID, {});
  const m2 = message(APP_ID, {});
  const m3 = message(APP_ID, {});
  const p1 = handle('getOverview', m1);
  const p2 = handle('getOverview', m2);
  await handle('getOverview', m3);
  assert.strictEqual(m3.responses[0].errorCode, 'BUSY');

  await new Promise((r) => setImmediate(r));
  assert.deepStrictEqual(order, ['início 0']);
  gates[0].resolve();
  await p1;
  await new Promise((r) => setImmediate(r));
  gates[1].resolve();
  await p2;
  assert.deepStrictEqual(order, ['início 0', 'fim 0', 'início 1', 'fim 1']);
});
