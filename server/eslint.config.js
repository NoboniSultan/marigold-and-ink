import js from '@eslint/js';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

export default [
  { ignores: ['coverage/', 'node_modules/'] },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': 'error',
      eqeqeq: ['error', 'always'],
      'prefer-const': 'error',
    },
  },
  {
    // Tests import describe/it/expect explicitly from vitest, so no test globals are needed.
    files: ['**/*.test.js', 'tests/**/*.js'],
    rules: { 'no-console': 'off' },
  },
  // Must be last: turns off stylistic rules that would fight Prettier.
  prettier,
];
