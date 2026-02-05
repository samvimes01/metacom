'use strict';

const { Server } = require('metacom');

/**
Fields and methods of impress application used inside metacom:

application.console
application.auth.saveSession(token, data)
application.static (used as (application.static.constructor.name !== 'Static'))
application.static.serve(url: string, transport: transports.HttpTransport)
application.getMethod(unit, ver, methodName)
application.getHook(unit)
*/

class FastifyApplicationAdapter {
  constructor(fastify, options = {}) {
    this.fastify = fastify;
    this.console = options.console || console;
    this.sessionStore = options.sessionStore; // e.g., Redis, in-memory Map
    this.apiRegistry = new Map(); // unit -> version -> method -> handler
    this.hookRegistry = new Map(); // unit -> hook

    // Tell Fastify to skip processing /api routes - metacom handles them
    fastify.addHook('onRequest', async (request, reply) => {
      if (request.raw.url.startsWith('/api')) {
        // Hijack the request - Fastify won't process it further
        // This prevents Fastify from consuming the request body stream
        // metacom will handle it as data = await metautil.receiveBody(req)
        reply.hijack();
      }
    });
  }

  // Auth interface
  get auth() {
    return {
      saveSession: async (token, data) => {
        await this.sessionStore.set(token, data);
      },
    };
  }

  // Static file serving - Fastify handles this via its own routing
  // eslint-disable-next-line class-methods-use-this
  get static() {
    // Return non-Static constructor so metacom skips static file handling
    return { constructor: { name: 'None' } };
  }

  // API method registration and retrieval
  // TODO: find out more about impress unit versions
  registerMethod({ unit, methodName, handler, access = 'public' }) {
    if (!this.apiRegistry.has(unit)) {
      this.apiRegistry.set(unit, new Map());
    }
    const unitMethods = this.apiRegistry.get(unit);
    unitMethods.set(methodName, { handler, access });
  }

  getMethod(unit, ver, methodName) {
    const unitMethods = this.apiRegistry.get(unit);
    if (!unitMethods) return null;

    const method = unitMethods.get(methodName);
    if (!method) return null;

    // Wrap handler to match expected interface
    return {
      access: method.access,
      enter: async () => {
        /* semaphore/rate limiting */
      },
      invoke: async (context, args) => method.handler(context, args),
      leave: () => {
        /* cleanup */
      },
    };
  }

  // Hook registration for REST-style endpoints
  registerHook({ unit, handler, access = 'public' }) {
    this.hookRegistry.set(unit, {
      router: {
        access,
        enter: async () => {},
        invoke: async (context, params) => handler(context, params),
        leave: () => {},
      },
    });
  }

  getHook(unit) {
    return this.hookRegistry.get(unit) || null;
  }
}

class MetacomServerFactory {
  static create(options) {
    const { application, adapter } = options;
    const FACTORIES = {
      fastify: this.#createForFastify,
      impress: this.#createForImpress,
    };

    const factory = FACTORIES[adapter];
    if (!factory) throw new Error(`Unknown adapter: ${adapter}`);

    return factory(application, options);
  }

  static #createForImpress(application, options) {
    return {
      metacomServer: new Server(application, options.metacomOpts),
      adapter: application,
    };
  }

  static #createForFastify(fastify, options) {
    const { serverOpts, metacomOpts } = options;

    const adapter = new FastifyApplicationAdapter(fastify, {
      console: metacomOpts.console,
      sessionStore: metacomOpts.sessionStore,
    });

    // Pass Fastify's HTTP server to metacom
    metacomOpts.httpServer = fastify.server;
    metacomOpts.externalServer = {
      listen: () => fastify.listen(serverOpts),
    };

    const metacomServer = new Server(adapter, metacomOpts);
    return { metacomServer, adapter };
  }
}

module.exports = { MetacomServerFactory };
