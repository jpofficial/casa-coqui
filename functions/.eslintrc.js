'use strict';

module.exports = {
  env: {
    es2022: true,
    node: true,
  },
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'commonjs',
  },
  extends: ['eslint:recommended'],
  rules: {
    // Allow console.log — Cloud Functions rely on structured logging.
    'no-console': 'off',
    // Enforce consistent use of const/let over var.
    'no-var': 'error',
    'prefer-const': 'warn',
    // Require semicolons.
    semi: ['warn', 'always'],
    // Trailing commas help diff readability.
    'comma-dangle': ['warn', 'always-multiline'],
  },
};
