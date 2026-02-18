'use strict';

const metautil = require('metautil');
const { Emitter } = metautil;
const { MetaReadable, MetaWritable } = require('./streams.js');
const { chunkDecode } = require('./chunks.js');

const EMPTY_PACKET = Buffer.from('{}');

const createProxy = (data, save) =>
  new Proxy(data, {
    get: (data, key) => {
      const value = Reflect.get(data, key);
      return value;
    },
    set: (data, key, value) => {
      const success = Reflect.set(data, key, value);
      if (save) save(data);
      return success;
    },
  });

class Session {
  constructor(token, data, protocol) {
    this.token = token;
    this.state = createProxy(data, (data) => {
      protocol.saveSession(token, data).catch((error) => {
        protocol.console.error(error);
      });
    });
  }
}

class Context {
  constructor(client) {
    this.client = client;
    this.uuid = metautil.generateUUID();
    this.state = {};
    this.session = client?.session || null;
  }
}

class Client extends Emitter {
  #transport;
  #protocol;

  constructor(transport, protocol) {
    super();
    this.#transport = transport;
    this.#protocol = protocol;
    this.ip = transport.ip;
    this.session = null;
    this.streams = new Map();
    protocol.clients.add(this);
    transport.once('close', () => {
      this.destroy();
      protocol.clients.delete(this);
    });
  }

  error(code, options) {
    this.#transport.error(code, options);
  }

  send(obj, code) {
    this.#transport.send(obj, code);
  }

  createContext() {
    return new Context(this);
  }

  emit(name, data) {
    if (name === 'close') return void super.emit(name, data);
    this.sendEvent(name, data);
  }

  sendEvent(name, data) {
    const packet = { type: 'event', name, data };
    if (!this.#transport.connection) {
      throw new Error(`Can't send metacom event to http transport`);
    }
    this.send(packet);
  }

  getStream(id) {
    if (!this.#transport.connection) {
      throw new Error(`Can't receive stream from http transport`);
    }
    const stream = this.streams.get(id);
    if (stream) return stream;
    throw new Error(`Stream ${id} is not initialized`);
  }

  createStream(name, size) {
    if (!this.#transport.connection) {
      throw new Error(`Can't send metacom streams to http transport`);
    }
    if (!name) throw new Error('Stream name is not provided');
    if (!size) throw new Error('Stream size is not provided');
    const id = this.#protocol.generateId();
    const stream = new MetaWritable(id, name, size, this.#transport);
    this.streams.set(id, stream);
    return stream;
  }

  initializeSession(token, data = {}) {
    this.finalizeSession();
    this.session = new Session(token, data, this.#protocol);
    this.#protocol.sessions.set(token, this.session);
    return true;
  }

  finalizeSession() {
    if (!this.session) return false;
    this.#protocol.sessions.delete(this.session.token);
    this.session = null;
    return true;
  }

  startSession(token, data = {}) {
    this.initializeSession(token, data);
    if (!this.#transport.connection) this.#transport.sendSessionCookie(token);
    return true;
  }

  restoreSession(token) {
    const session = this.#protocol.sessions.get(token);
    if (!session) return false;
    this.session = session;
    return true;
  }

  close() {
    this.#transport.close();
  }

  destroy() {
    this.emit('close');
    if (!this.session) return;
    this.#protocol.sessions.delete(this.session.token);
  }
}

class MetacomProtocol {
  constructor(options) {
    this.console = options.console || console;
    this.generateId = options.generateId || (() => metautil.generateUUID());
    this.getMethod = options.getMethod;
    this.getHook = options.getHook || (() => null);
    this.saveSession = options.saveSession || (async () => {});
    this.sessions = new Map();
    this.clients = new Set();
  }

  createClient(transport) {
    return new Client(transport, this);
  }

  async handleHttpRequest(client, transport, req) {
    const data = await metautil.receiveBody(req).catch(() => null);
    if (req.url === '/api') {
      if (req.method !== 'POST') transport.error(403);
      else this.message(client, data);
      return;
    }
    this.request(client, transport, data);
  }

  handleWsMessage(client, data, isBinary) {
    if (isBinary) this.binary(client, new Uint8Array(data));
    else this.message(client, data);
  }

  message(client, data) {
    if (Buffer.compare(EMPTY_PACKET, data) === 0) {
      return void client.send({});
    }
    const packet = metautil.jsonParse(data) || {};
    const { id, type, method } = packet;
    if (type === 'call' && id && method) return void this.rpc(client, packet);
    else if (type === 'stream' && id) return void this.stream(client, packet);
    const error = new Error('Packet structure error');
    client.error(500, { error, pass: true });
  }

  async rpc(client, packet) {
    const { id, method, args } = packet;
    const [unitName, methodName] = method.split('/');
    const [unit, ver = '*'] = unitName.split('.');
    const proc = this.getMethod(unit, ver, methodName);
    if (!proc) return void client.error(404, { id });
    const context = client.createContext();
    if (!client.session && proc.access !== 'public') {
      return void client.error(403, { id });
    }
    try {
      await proc.enter();
    } catch {
      return void client.error(503, { id });
    }
    let result = null;
    try {
      result = await proc.invoke(context, args);
    } catch (error) {
      let code = error.code === 'ETIMEOUT' ? 408 : 500;
      if (typeof error.code === 'number') code = error.code;
      error.httpCode = code <= 599 ? code : 500;
      return void client.error(code, { id, error });
    } finally {
      proc.leave();
    }
    if (metautil.isError(result)) {
      const { code, httpCode = 200 } = result;
      return void client.error(code, { id, error: result, httpCode });
    }
    client.send({ type: 'callback', id, result });
    this.console.log(`${client.ip}\t${method}`);
  }

  async stream(client, packet) {
    const { id, name, size, status } = packet;
    const tag = id + '/' + name;
    try {
      const stream = client.streams.get(id);
      if (status) {
        if (!stream) throw new Error(`Stream ${tag} is not initialized`);
        if (status === 'end') await stream.close();
        if (status === 'terminate') await stream.terminate();
        return void client.streams.delete(id);
      }
      const valid = typeof name === 'string' && Number.isSafeInteger(size);
      if (!valid) throw new Error('Stream packet structure error');
      if (stream) throw new Error(`Stream ${tag} is already initialized`);
      {
        const stream = new MetaReadable(id, name, size);
        client.streams.set(id, stream);
        this.console.log(`${client.ip}\tstream ${tag} init`);
      }
    } catch (error) {
      this.console.error(`${client.ip}\tstream ${tag} error`);
      client.error(400, { id, error, pass: true });
    }
  }

  binary(client, data) {
    const { id, payload } = chunkDecode(data);
    try {
      const upstream = client.streams.get(id);
      if (upstream) {
        upstream.push(payload);
      } else {
        const error = new Error(`Stream ${id} is not initialized`);
        client.error(400, { id, error, pass: true });
      }
    } catch (error) {
      this.console.error(`${client.ip}\tstream ${id} error`);
      client.error(400, { id: this.generateId(), error });
    }
  }

  request(client, transport, data) {
    const { headers, url, method: verb } = transport.req;
    const pathname = url.slice('/api/'.length);
    const [path, params] = metautil.split(pathname, '?');
    const parameters = metautil.parseParams(params);
    const [unit, method] = metautil.split(path, '/');
    const body = metautil.jsonParse(data) || {};
    const args = { ...parameters, ...body };
    const packet = { id: this.generateId(), method: unit + '/' + method, args };
    const hook = this.getHook(unit);
    if (hook) this.hook(client, hook, packet, verb, headers);
    else this.rpc(client, packet);
  }

  async hook(client, proc, packet, verb, headers) {
    const { id, method, args } = packet;
    if (!proc) return void client.error(404, { id });
    const context = client.createContext();
    try {
      await proc.enter();
    } catch {
      return void client.error(503, { id });
    }
    let result = null;
    try {
      const par = { verb, method, args, headers };
      result = await proc.invoke(context, par);
    } catch (error) {
      client.error(500, { id, error });
    } finally {
      proc.leave();
    }
    if (metautil.isError(result)) {
      const { code, httpCode = 200 } = result;
      return void client.error(code, { id, error: result, httpCode });
    }
    client.send(result);
    this.console.log(`${client.ip}\t${method}`);
  }

  closeClients() {
    for (const client of this.clients) {
      client.close();
    }
  }
}

module.exports = { MetacomProtocol, Client, Session, Context };
