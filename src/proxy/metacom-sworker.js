'use strict';
importScripts('metacom-iife.js');

// exists in global scope after importScripts
const { Metacom } = MetacomIIFE;

const communicationPorts = new Set();

self.addEventListener('message', async ({ data, ports } = {}) => {
  if (!ports[0] || !data || data.type !== 'PORT_INITIALIZATION') {
    return;
  }
  const messagePort = ports[0];
  const { isSecure, host, metacomLoad } = data;
  communicationPorts.add(messagePort);

  const protocol = isSecure ? 'wss' : 'ws';
  const metacom = Metacom.create(`${protocol}://${host}/api`);

  messagePort.onmessage = async ({ data }) => {
    const { unit, method, packet } = data;
    const { id, args } = packet;
    const result = await metacom.api[unit][method](args, id);
    messagePort.postMessage({
      type: 'RESULT',
      payload: {
        result,
        type: 'callback',
        id,
        name: unit + '/' + method,
      },
    });
  };

  const introspection = await metacom.load(...metacomLoad);

  messagePort.postMessage({ type: 'INTROSPECTION', payload: introspection });
});
