import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
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
  prettier,
);
