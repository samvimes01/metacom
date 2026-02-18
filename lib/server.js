'use strict';

const http = require('node:http');
const https = require('node:https');
const metautil = require('metautil');
const ws = require('ws');
const { HttpTransport, WsTransport, HEADERS } = require('./transport.js');
const { MetacomProtocol } = require('./protocol.js');

const SHORT_TIMEOUT = 500;
const DEFAULT_LISTEN_RETRY = 3;

const addHeaders = ({ origin }) => {
  if (origin) HEADERS['Access-Control-Allow-Origin'] = origin;
};

class Server {
  constructor(application, options) {
    this.retry = options.retry ?? DEFAULT_LISTEN_RETRY;
    this.application = application;
    this.options = options;
    this.balancer = options.kind === 'balancer';
    this.console = application.console;
    this.serveStatic = options.serveStatic ?? true;
    if (options.cors) addHeaders(options.cors);

    this.protocol = new MetacomProtocol({
      console: application.console,
      generateId: options.generateId,
      getMethod: (unit, ver, methodName) =>
        application.getMethod(unit, ver, methodName),
      getHook: (unit) => application.getHook(unit),
      saveSession: (token, data) => application.auth.saveSession(token, data),
    });

    this.clients = this.protocol.clients;
    this.generateId = this.protocol.generateId;
    this.httpServer = null;
    this.wsServer = null;
    this.externalServer = options.externalServer || null;
    this.init();
  }

  init() {
    const { application, balancer, options, protocol } = this;
    const {
      httpServer,
      protocol: proto,
      nagle = true,
      key,
      cert,
      SNICallback,
    } = options;

    if (httpServer) {
      this.httpServer = httpServer;
    } else {
      const httpProto = proto === 'http' || balancer ? http : https;
      const opt = { key, cert, noDelay: !nagle, SNICallback };
      this.httpServer = httpProto.createServer(opt);
    }

    this.httpServer.on('request', async (req, res) => {
      const api = req.url.startsWith('/api');

      if (this.externalServer && !api) return;

      const transport = new HttpTransport(this, req, res);
      if (!api && !(balancer && req.url === '/')) {
        if (!this.serveStatic || !application.static?.serve) return;
        return void application.static.serve(req.url, transport);
      }
      if (balancer) this.balancing(transport);
      if (res.writableEnded) return;

      const client = protocol.createClient(transport);
      await protocol.handleHttpRequest(client, transport, req);
    });

    if (balancer) return;
    this.wsServer = new ws.Server({ server: this.httpServer });

    this.wsServer.on('connection', (connection, req) => {
      const transport = new WsTransport(this, req, connection);
      const client = protocol.createClient(transport);

      connection.on('message', (data, isBinary) => {
        protocol.handleWsMessage(client, data, isBinary);
      });
    });
  }

  listen() {
    const { console, options } = this;
    const { host, port, timeouts } = options;

    return new Promise((resolve, reject) => {
      this.httpServer.on('listening', () => {
        console.info(`Listen port ${port}`);
        resolve(this);
      });

      const server = this.wsServer || this.httpServer;
      server.on('error', (error) => {
        if (error.code !== 'EADDRINUSE') return;
        this.retry--;
        if (this.retry === 0) return void reject(error);
        console.warn(`Address in use: ${host}:${port}, retry...`);
        setTimeout(() => {
          this.httpServer.listen(port, host);
        }, timeouts.bind);
      });

      if (this.externalServer) {
        console.info(`Attached to external server`);
        this.externalServer.listen();
        return;
      }

      this.httpServer.listen(port, host);
    });
  }

  balancing(transport) {
    const host = metautil.parseHost(transport.req.headers.host);
    const { protocol, ports } = this.options;
    const targetPort = metautil.sample(ports);
    const targetPath = transport.req.url || '/';
    transport.redirect(`${protocol}://${host}:${targetPort}${targetPath}`);
  }

  closeClients() {
    this.protocol.closeClients();
  }

  async close() {
    if (!this.httpServer.listening) return;
    if (!this.options.httpServer) {
      this.httpServer.close((error) => {
        if (error) this.console.error(error);
      });
    }
    if (this.clients.size === 0) return;
    this.closeClients();
    while (this.clients.size > 0) {
      await metautil.delay(SHORT_TIMEOUT);
    }
  }
}

module.exports = { Server };
