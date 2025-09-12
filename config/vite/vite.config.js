/* eslint-disable */

/**
 * @file Vite configuration for Emulsify.
 */

import { defineConfig } from 'vite';
import { resolve } from 'path';
import { resolveEnvironment } from './environment.js';
import { makePlugins } from './plugins.js';
import { buildInputs, makePatterns } from './entries.js';

const env = resolveEnvironment();

// Build input map using the extracted module (keeps this file small & readable).
const patterns = makePatterns({
  projectDir: env.projectDir,
  srcDir: env.srcDir,
  srcExists: env.srcExists,
  isDrupal: env.isDrupal,
});
const entries = buildInputs(
  {
    projectDir: env.projectDir,
    srcDir: env.srcDir,
    srcExists: env.srcExists,
    isDrupal: env.isDrupal,
  },
  patterns,
);

console.log('Vite Inputs:', entries);


export default defineConfig({
  plugins: makePlugins(env),

  css: {
    preprocessorOptions: {
      scss: {
        additionalData: `$env: ${process.env.NODE_ENV};`,
        includePaths: [resolve(env.projectDir, 'src/styles')],
      },
    },
  },

  build: {
    emptyOutDir: true,
    outDir: 'dist',
    rollupOptions: {
      input: entries,
      output: {
        entryFileNames: '[name].js',
        assetFileNames: (assetInfo) => {
          const n = assetInfo.name ?? '';
          if (n.endsWith('.css')) return '[name].css';
          return 'assets/[name][extname]';
        },
      },
    },
    watch: {},
  },
});
