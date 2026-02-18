/* eslint-disable no-unused-vars */
'use strict';

const path = require('node:path');
const fastify = require('fastify')({
  disableRequestLogging: false,
});

const { MetacomServerFactory } = require('../metacom.js');

// Session store (could be Redis, etc.)
const sessionStore = new Map();

fastify.register(require('@fastify/static'), {
  root: path.join(__dirname, 'public'),
});

fastify.get('/health', async (request, reply) => ({ status: 'ok' }));

const start = async ({ protocol, host, port }) => {
  // 1. Create metacom with Fastify's HTTP server
  const { metacomServer, adapter } = MetacomServerFactory.create({
    application: fastify,
    adapter: 'fastify',
    serverOpts: {
      protocol,
      host,
      port,
    },
    metacomOpts: {
      protocol,
      host,
      port,
      cors: { origin: '*' },
      sessionStore: {
        set: async (token, data) => sessionStore.set(token, data),
        get: async (token) => sessionStore.get(token),
      },
    },
  });

  // 2. Register API methods specific to metacom on /api route
  adapter.registerMethod({
    unit: 'system',
    methodName: 'introspect',
    handler: async (context, args) => ({
      auth: { restore: ['token'], signin: ['login', 'password'] },
      example: { counter: [] },
    }),
  });
  adapter.registerMethod({
    unit: 'auth',
    methodName: 'signin',
    handler: async (context, { username, password }) => ({
      success: true,
      token: 'xyz',
    }),
  });

  adapter.registerMethod({
    unit: 'auth',
    methodName: 'restore',
    handler: async (context, args) =>
      // Requires session
      context.session.state,
  });

  let counter = 0;
  adapter.registerMethod({
    unit: 'example',
    methodName: 'counter',
    handler: async (context, args) => ({ result: ++counter }),
  });

  // 3. Start server
  await metacomServer.listen();
  console.log(`Fastify with metacom listening on ${port}`);
};

start({ protocol: 'http', host: '127.0.0.1', port: '8080' }).catch((err) => {
  console.error(err);
  process.exit(1);
});
