'use strict';

const fp = require('fastify-plugin');
const { Server } = require('./server.js');
const { HEADERS } = require('./transport.js');

const addHeaders = ({ origin }) => {
  if (origin) HEADERS['Access-Control-Allow-Origin'] = origin;
};

async function metacomPlugin(fastify, opts) {
  const {
    saveSession = async () => {},
    generateId,
    timeouts,
    queue,
    cors,
  } = opts;

  if (cors) addHeaders(cors);

  const methods = new Map();
  const hooks = new Map();

  const logger = opts.console || {
    log: fastify.log.info.bind(fastify.log),
    info: fastify.log.info.bind(fastify.log),
    warn: fastify.log.warn.bind(fastify.log),
    error: fastify.log.error.bind(fastify.log),
    debug: fastify.log.debug.bind(fastify.log),
  };

  const application = {
    console: logger,
    auth: { saveSession },
    getMethod(unit, ver, methodName) {
      const entry = methods.get(`${unit}/${methodName}`);
      if (!entry) return null;
      return {
        access: entry.access || 'public',
        enter: entry.enter || (async () => {}),
        invoke: async (context, args) => entry.handler(context, args),
        leave: entry.leave || (() => {}),
      };
    },
    getHook(unit) {
      return hooks.get(unit) || null;
    },
  };

  // Hijack /api routes before Fastify parses the body,
  // so metacom can read the raw request stream via metautil.receiveBody
  fastify.addHook('onRequest', async (req, reply) => {
    if (req.raw.url.startsWith('/api')) reply.hijack();
  });

  const metacomServer = new Server(application, {
    protocol: opts.protocol || 'http',
    host: opts.host,
    port: opts.port,
    cors,
    generateId,
    timeouts,
    queue,
    httpServer: fastify.server,
    serveStatic: false,
  });

  fastify.decorate('metacom', {
    server: metacomServer,

    method({ unit, method: methodName, handler, access = 'public', enter, leave }) {
      methods.set(`${unit}/${methodName}`, { handler, access, enter, leave });
    },

    hook({ unit, handler, access = 'public' }) {
      hooks.set(unit, {
        router: {
          access,
          enter: async () => {},
          invoke: async (context, params) => handler(context, params),
          leave: () => {},
        },
      });
    },

    get clients() {
      return metacomServer.clients;
    },
  });

  fastify.addHook('onClose', async () => {
    await metacomServer.close();
  });
}

module.exports = fp(metacomPlugin, {
  name: 'metacom',
  fastify: '>=4.0.0',
});
