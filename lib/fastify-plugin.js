'use strict';

const fp = require('fastify-plugin');
const ws = require('ws');
const { HttpTransport, WsTransport, HEADERS } = require('./transport.js');
const { MetacomProtocol } = require('./protocol.js');

const addHeaders = ({ origin }) => {
  if (origin) HEADERS['Access-Control-Allow-Origin'] = origin;
};

async function metacomPlugin(fastify, opts) {
  const { saveSession = async () => {}, generateId, cors } = opts;

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

  const protocol = new MetacomProtocol({
    console: logger,
    generateId,
    saveSession,
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
  });

  // Transport needs a server-like object for console and error logging
  const serverShim = {
    console: logger,
    clients: protocol.clients,
    generateId: protocol.generateId,
  };

  // Hijack /api routes before Fastify parses the body,
  // so metacom can read the raw request stream via metautil.receiveBody
  fastify.addHook('onRequest', async (req, reply) => {
    if (req.raw.url.startsWith('/api')) reply.hijack();
  });

  fastify.server.on('request', async (req, res) => {
    if (!req.url.startsWith('/api')) return;
    const transport = new HttpTransport(serverShim, req, res);
    const client = protocol.createClient(transport);
    await protocol.handleHttpRequest(client, transport, req);
  });

  const wsServer = new ws.Server({ server: fastify.server });
  wsServer.on('connection', (connection, req) => {
    const transport = new WsTransport(serverShim, req, connection);
    const client = protocol.createClient(transport);
    connection.on('message', (data, isBinary) => {
      protocol.handleWsMessage(client, data, isBinary);
    });
  });

  fastify.decorate('metacom', {
    protocol,

    method({
      unit,
      method: methodName,
      handler,
      access = 'public',
      enter,
      leave,
    }) {
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
      return protocol.clients;
    },
  });

  fastify.addHook('onClose', async () => {
    wsServer.close();
    protocol.closeClients();
  });
}

module.exports = fp(metacomPlugin, {
  name: 'metacom',
  fastify: '>=4.0.0',
});
