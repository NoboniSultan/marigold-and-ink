import js from '@eslint/js';
import globals from 'globals';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

const TS_FILES = ['**/*.ts'];
const unusedVarsOptions = { argsIgnorePattern: '^_', ignoreRestSiblings: true };

export default [
  { ignores: ['coverage/', 'node_modules/'] },
  js.configs.recommended,
  // TypeScript rules apply to .ts files only; .js files keep the plain rules below.
  ...tseslint.configs.recommended.map((config) => ({ ...config, files: TS_FILES })),
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      // ignoreRestSiblings allows `const { secret: _omit, ...safe } = obj` to drop a field.
      'no-unused-vars': ['error', unusedVarsOptions],
      'no-console': 'error',
      eqeqeq: ['error', 'always'],
      'prefer-const': 'error',
    },
  },
  {
    files: TS_FILES,
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', unusedVarsOptions],
      // `@shared/*` exists only for the type checker (tsconfig "paths"); Node can't resolve it.
      // A value import would crash at runtime, so only `import type` is allowed.
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@shared/*'],
              allowTypeImports: true,
              message: 'Use `import type` for @shared: it is a type-only alias.',
            },
          ],
        },
      ],
    },
  },
  {
    // Tests import describe/it/expect explicitly from vitest, so no test globals are needed.
    files: ['**/*.test.js', '**/*.test.ts', 'tests/**/*.js', 'scripts/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
  // Must be last: turns off stylistic rules that would fight Prettier.
  prettier,
];
