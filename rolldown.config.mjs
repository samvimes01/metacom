import { defineConfig } from 'rolldown';

export default defineConfig([
  {
    input: 'src/proxy/metacom-sworker.js',
    output: {
      file: 'dist/metacom-sworker.js',
      name: 'MetacomServiceWorkerProxy',
    },
  },
  // iife bundle for worker
  {
    input: 'src/metacom.js',
    output: {
      file: 'dist/metacom-iife.js',
      format: 'iife',
      name: 'MetacomIIFE',
    },
  },
  // es bundle for main thread module
  // bundler is required to include metautils dependency
  {
    input: 'src/metacom.js',
    output: {
      file: 'dist/metacom.js',
      format: 'es',
      name: 'Metacom',
    },
  },
  // TODO: copy proxy to dist as is
]);
