'use strict';
importScripts('metacom.iife.js');

// exists in global scope after importScripts
const { Metacom } = metacomIIFE;

const metacomUrls = new Map();

self.addEventListener('message', async ({ data, ports } = {}) => {
  if (!ports[0] || !data || data.type !== 'PORT_INITIALIZATION') {
    return;
  }
  const messagePort = ports[0];
  const { url, metacomLoad } = data;

  let metacom = metacomUrls.get(url);

  if (!metacom) {
    metacom = Metacom.create(url);
    metacomUrls.set(url, metacom);
  }

  messagePort.onmessage = async ({ data }) => {
    const { unit, method, packet } = data;
    const { id, args } = packet;
    const result = await metacom.api[unit][method](args);
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
