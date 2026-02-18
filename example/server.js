'use strict';

const path = require('node:path');
const fastify = require('fastify')();

fastify.register(require('@fastify/static'), {
  root: path.join(__dirname, 'public'),
});

fastify.register(require('../fastify.js'), {
  protocol: 'http',
  host: '127.0.0.1',
  port: 8080,
  cors: { origin: '*' },
  saveSession: async (token, data) => {
    console.log(`Session saved: ${token}`);
  },
});

fastify.after(() => {
  fastify.metacom.method({
    unit: 'system',
    method: 'introspect',
    handler: async (context, args) => ({
      auth: { restore: ['token'], signin: ['login', 'password'] },
      example: { counter: [] },
    }),
  });

  fastify.metacom.method({
    unit: 'auth',
    method: 'signin',
    handler: async (context, { username, password }) => ({
      success: true,
      token: 'xyz',
    }),
  });

  let counter = 0;
  fastify.metacom.method({
    unit: 'example',
    method: 'counter',
    handler: async (context, args) => ({ result: ++counter }),
  });
});

fastify.get('/health', async () => ({ status: 'ok' }));

fastify.listen({ port: 8080, host: '127.0.0.1' }).then(() => {
  console.log('Fastify with metacom listening on 8080');
});
