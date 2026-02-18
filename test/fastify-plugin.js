'use strict';

const { WebSocket } = require('ws');
const { randomUUID } = require('node:crypto');
const { test } = require('node:test');
const assert = require('node:assert');
const Fastify = require('fastify');
const metacomPlugin = require('../fastify.js');

const { emitWarning } = process;
process.emitWarning = (warning, type, ...args) => {
  if (type === 'ExperimentalWarning') return;
  emitWarning(warning, type, ...args);
};

const HOST = '127.0.0.1';
const PORT = 8004;

test('Fastify plugin / calls', async (t) => {
  let fastify;

  t.beforeEach(async () => {
    // eslint-disable-next-line new-cap
    fastify = Fastify();

    fastify.register(metacomPlugin, {
      protocol: 'http',
      host: HOST,
      port: PORT,
      cors: { origin: '*' },
      saveSession: async () => {},
    });

    fastify.after(() => {
      fastify.metacom.method({
        unit: 'test',
        method: 'hello',
        handler: async (context, { name }) => `Hello, ${name}`,
      });
    });

    fastify.get('/health', async () => ({ status: 'ok' }));

    await fastify.listen({ port: PORT, host: HOST });
  });

  t.afterEach(async () => {
    await fastify.close();
  });

  await t.test('handles HTTP RPC via metacom protocol', async () => {
    const id = randomUUID();
    const args = { name: 'Max' };
    const packet = { type: 'call', id, method: 'test/hello', args };
    const response = await fetch(`http://${HOST}:${PORT}/api`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(packet),
    }).then((res) => res.json());

    assert.strictEqual(response.id, id);
    assert.strictEqual(response.type, 'callback');
    assert.strictEqual(response.result, `Hello, ${args.name}`);
  });

  await t.test('handles WS RPC via metacom protocol', async () => {
    const id = randomUUID();
    const args = { name: 'Max' };
    const packet = { type: 'call', id, method: 'test/hello', args };
    const socket = new WebSocket(`ws://${HOST}:${PORT}`);
    await new Promise((res) => socket.on('open', res));
    socket.send(JSON.stringify(packet));
    const resPacket = await new Promise((res) => socket.on('message', res));
    const response = JSON.parse(resPacket);
    assert.strictEqual(response.id, id);
    assert.strictEqual(response.type, 'callback');
    assert.strictEqual(response.result, `Hello, ${args.name}`);
    socket.close();
  });

  await t.test('Fastify routes still work alongside metacom', async () => {
    const response = await fetch(`http://${HOST}:${PORT}/health`);
    const data = await response.json();
    assert.deepStrictEqual(data, { status: 'ok' });
  });

  await t.test('returns 404 for unknown metacom method', async () => {
    const id = randomUUID();
    const packet = { type: 'call', id, method: 'unknown/method', args: {} };
    const response = await fetch(`http://${HOST}:${PORT}/api`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(packet),
    }).then((res) => res.json());

    assert.strictEqual(response.error.code, 404);
  });
});
