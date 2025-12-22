'use strict';

const init = require('eslint-config-metarhia');

module.exports = [
  ...init,
  {
    ignores: ['node_modules/*', 'rolldown.config.mjs', 'dist/*.js'],
  },
  {
    files: ['dist/**/*.js', 'src/*.js'],
    languageOptions: {
      sourceType: 'module',
      globals: {
        crypto: 'readonly',
      },
    },
  },
  {
    files: ['src/proxy/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: {
        importScripts: 'readonly',
        MetacomIIFE: 'readonly',
      },
    },
  },
];
