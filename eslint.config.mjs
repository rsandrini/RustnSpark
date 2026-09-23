import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores([
    '**/node_modules/',
    '**/dist/',
    '**/coverage/',
    'docs/',
    'design/',
    'prototypes/',
    'simulation/',
    '.superpowers/',
  ]),
  js.configs.recommended,
  {
    files: ['**/*.ts'],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      globals: { ...globals.node, ...globals.jest },
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    files: ['**/*.tsx'],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    settings: { react: { version: 'detect' } },
  },
  {
    files: ['**/*.mjs'],
    languageOptions: { globals: globals.node },
  },
  {
    // Rules take a seeded Rng; nothing in the API may draw from the global generator.
    files: ['apps/api/src/**/*.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: 'Use the seeded Rng (src/common/rng) instead of Math.random.',
        },
      ],
    },
  },
  {
    // Tunable numbers live in the database; rule code must name or config-drive literals.
    files: [
      'apps/api/src/resolution/**/*.ts',
      'apps/api/src/economy/**/*.ts',
      'apps/api/src/ships/**/*.ts',
      'apps/api/src/parts/**/*.ts',
      'apps/api/src/missions/**/*.ts',
    ],
    rules: {
      'no-magic-numbers': [
        'error',
        {
          ignore: [0, 1, -1, 100],
          ignoreArrayIndexes: false,
          ignoreDefaultValues: false,
          ignoreClassFieldInitialValues: false,
          enforceConst: true,
          detectObjects: false,
        },
      ],
    },
  },
  {
    // Resolution and pure economy calculators never touch I/O (plan S5.9).
    // Only Nest wiring files under resolution/ are exempt.
    files: ['apps/api/src/resolution/**/*.ts', 'apps/api/src/economy/*.calculator.ts'],
    ignores: ['apps/api/src/resolution/**/*.module.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@prisma/client',
              message: 'Resolution/pure economy code must stay I/O-free (S5.9).',
            },
            {
              name: 'bullmq',
              message: 'Resolution/pure economy code must stay I/O-free (S5.9).',
            },
          ],
          patterns: [
            {
              group: ['@nestjs/*'],
              message: 'Resolution/pure economy code must stay I/O-free (S5.9).',
            },
          ],
        },
      ],
    },
  },

  {
    // The web app stores tokens in memory and serves player-facing text from locale files.
    files: ['apps/web/src/**/*.ts', 'apps/web/src/**/*.tsx'],
    plugins: { react, 'react-hooks': reactHooks },
    languageOptions: { globals: globals.browser },
    settings: { react: { version: 'detect' } },
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: 'Do not use Math.random in the web app.',
        },
      ],
      'react/jsx-no-literals': ['error', { noStrings: true, ignoreProps: true }],
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  prettier,
);
