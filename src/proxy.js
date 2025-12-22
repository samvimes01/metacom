import { Metacom } from './metacom.js';
/**
 * @param {string[]} metacomLoad list of remote procedures names
 * @returns {Metacom}
 */
export const getMetacomProxy = async (metacomLoad) => {
  const messageChannel = new MessageChannel();
  const messagePort = messageChannel.port1;

  const { protocol, hostname, port } = location;
  const worker = navigator.serviceWorker.controller;

  if (!worker) {
    throw new Error('Service worker controller is not available');
  }

  worker.postMessage(
    {
      type: 'PORT_INITIALIZATION',
      isSecure: protocol === 'https:',
      host: `${hostname}:8002`,
      metacomLoad,
    },
    [messageChannel.port2],
  );

  const metacom = Metacom.create(`ws://${hostname}:${port}/api`, {
    messagePort,
  });

  const { promise, resolve } = Promise.withResolvers();
  messagePort.onmessage = ({ data }) => {
    if (data.type === 'INTROSPECTION') {
      // instead of metacom.load with implicit introspection call
      // use separate initApi call, when introspection data comes from worker
      metacom.initApi(metacomLoad, data.payload);
      resolve(metacom);
      return;
    }
    if (data.type === 'RESULT') {
      metacom.message(JSON.stringify(data.payload));
    }
  };

  return promise;
};
