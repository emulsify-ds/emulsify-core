/**
 * @file Vite configuration for Emulsify.
 */

import { defineConfig } from 'vite';

import { resolveEnvironment } from './environment.js';
import { makePlugins } from './plugins.js';
import { buildInputs, makePatterns } from './entries.js';

const env = resolveEnvironment();

// Build input map using the extracted module (keeps this file small & readable).
const patterns = makePatterns({
  projectDir: env.projectDir,
  srcDir: env.srcDir,
  srcExists: env.srcExists,
  isDrupal: env.platform === 'drupal',
  SDC: env.SDC,
  legacyVariant: env.legacyVariant,
  variantRoots: env.variantRoots,
});

const entries = buildInputs(
  {
    projectDir: env.projectDir,
    srcDir: env.srcDir,
    srcExists: env.srcExists,
    isDrupal: env.platform === 'drupal',
    SDC: env.SDC,
    legacyVariant: env.legacyVariant,
    variantRoots: env.variantRoots,
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
        assetFileNames: (assetInfo) => {
          const file = assetInfo.name || assetInfo.fileName || '';
          if (file.endsWith('.css')) {
            // Normalize path and drop the CSS_SUFFIX ('__style') used to avoid key collisions
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
