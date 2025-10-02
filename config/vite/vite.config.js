/**
 * @file Vite configuration for Emulsify.
 * @description
 * - Uses env flags from environment.js (including `SDC` from project.emulsify.json)
 * - Builds inputs with entries.js (SDC-aware keying)
 * - Strips the `__style` suffix from CSS assets in `assetFileNames`
 */

import { defineConfig } from 'vite';

import { resolveEnvironment } from './environment.js';
import { makePlugins } from './plugins.js';
import { buildInputs, makePatterns } from './entries.js';

const env = resolveEnvironment();

// Build input map using extracted helpers
const patterns = makePatterns({
  projectDir: env.projectDir,
  srcDir: env.srcDir,
  srcExists: env.srcExists,
  SDC: env.SDC,
});

const entries = buildInputs(
  {
    projectDir: env.projectDir,
    srcDir: env.srcDir,
    srcExists: env.srcExists,
    SDC: env.SDC,
  },
  patterns,
);

export default defineConfig({
  root: process.cwd(),
  plugins: makePlugins(env),
  css: { devSourcemap: true },
  build: {
    emptyOutDir: true,
    outDir: 'dist/',
    sourcemap: true,
    rollupOptions: {
      input: entries,
      output: {
        entryFileNames: '[name].js',
        /**
         * Keep asset paths stable and strip the SDC CSS suffix (`__style`) we use
         * in keys to avoid JS/CSS collisions when SDC === true.
         */
        assetFileNames: (assetInfo) => {
          const file = assetInfo.name || assetInfo.fileName || '';
          if (file.endsWith('.css')) {
            // drop the temporary suffix before the .css extension
            return file.replace(/__style(?=\.css$)/, '');
          }
          return 'assets/[name][extname]';
        },
      },
    },
    server: {
      watch: { usePolling: false },
    },
  },
});
