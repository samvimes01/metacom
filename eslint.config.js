'use strict';

const init = require('eslint-config-metarhia');
init[0].ignores.push('example/**');
module.exports = [
  ...init,
  {
    files: ['metacom.mjs'],
    languageOptions: {
      sourceType: 'module',
      globals: {
        crypto: 'readonly',
      },
    },
  },
];
