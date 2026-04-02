// Import ESLint Flat Config and required plugins
import js from '@eslint/js';
import pluginSecurity from 'eslint-plugin-security';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';

export default [
  // Base ESLint recommended rules
  js.configs.recommended,

  // Plugin configurations
  pluginSecurity.configs.recommended,
  eslintPluginPrettierRecommended,

  {
    name: 'emulsify-core-config',
    languageOptions: {
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
  },
];
