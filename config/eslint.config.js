// Import ESLint Flat Config and required plugins
import js from '@eslint/js';
import babelParser from '@babel/eslint-parser';
import importPlugin from 'eslint-plugin-import';
import pluginSecurity from 'eslint-plugin-security';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';

export default [
  // Base ESLint recommended rules
  js.configs.recommended,

  // Plugin configurations
  importPlugin.flatConfigs.recommended,
  pluginSecurity.configs.recommended,
  eslintPluginPrettierRecommended,

  {
    name: 'emulsify-core-config',
    languageOptions: {
      parser: babelParser,
      parserOptions: {
        requireConfigFile: false,
        babelOptions: {
          babelrc: false,
          configFile: false,
        },
      },
      sourceType: 'module',
      ecmaVersion: 'latest',
      globals: {
        expect: true,
        it: true,
        describe: true,
      },
    },

    files: ['**/*.{js,mjs,cjs}'],

    ignores: ['**/*.min.js', '**/node_modules/**/*'],

    rules: {
      strict: 0,
      'consistent-return': 'off',
      'no-underscore-dangle': 'off',
      'max-nested-callbacks': ['warn', 3],
      'import/extensions': 'off',
      'import/no-unresolved': 'off',
      'import/no-extraneous-dependencies': 'warn',
      'import/no-mutable-exports': 'warn',
      'no-plusplus': ['warn', { allowForLoopAfterthoughts: true }],
      'no-param-reassign': 'off',
      'no-prototype-builtins': 'off',
      'prettier/prettier': ['error', { singleQuote: true }],
      'no-unused-vars': 'warn',
      'no-undef': 'off',
      'operator-linebreak': [
        'error',
        'after',
        { overrides: { '?': 'ignore', ':': 'ignore' } },
      ],
      quotes: ['error', 'single'],
    },

    settings: {
      'import/ignore': ['\\.(scss|less|css)$'],
      'import/resolver': {
        node: {
          extensions: ['.js', '.jsx'],
          moduleDirectory: ['src', 'node_modules'],
        },
      },
    },
  },
];
