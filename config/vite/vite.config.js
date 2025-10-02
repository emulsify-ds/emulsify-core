/**
 * @file Vite configuration for Emulsify.
 * @description
 * - Resolves env (platform, paths) without relying on `singleDirectoryComponents` or `isDrupal`.
 * - Builds Rollup inputs with single-directory component semantics (CSS keys get `__style`).
 * - Co-locates CSS maps next to CSS and strips `__style` from filenames.
 */

import { defineConfig } from 'vite';

import { resolveEnvironment } from './environment.js';
import { makePlugins } from './plugins.js';
import { buildInputs, makePatterns } from './entries.js';

/** @type {{ projectDir: string, srcDir: string, srcExists: boolean, platform: string }} */
const env = resolveEnvironment();

/** Discover files to compile. */
const patterns = makePatterns({
  projectDir: env.projectDir,
  srcDir: env.srcDir,
  srcExists: env.srcExists,
  platform: env.platform,
});

/** Construct Rollup input map (keys encode output locations). */
const entries = buildInputs(
  {
    projectDir: env.projectDir,
    srcDir: env.srcDir,
    srcExists: env.srcExists,
    platform: env.platform,
  },
  patterns,
);

export default defineConfig({
  root: process.cwd(),

  plugins: makePlugins(env),

  css: {
    // dev sourcemaps; build sourcemaps enabled below
    devSourcemap: true,
  },

  build: {
    outDir: 'dist/',
    emptyOutDir: true,
    sourcemap: true, // JS & CSS maps

    rollupOptions: {
      input: entries,

      output: {
        /**
         * Use `[name]` (the input map key) for exact placement.
         */
        entryFileNames: '[name].js',

        /**
         * Place CSS and CSS sourcemaps **next to** their CSS and strip the
         * `__style` suffix used to avoid JS/CSS stem collisions.
         */
        assetFileNames: (assetInfo) => {
          const file = assetInfo.name || assetInfo.fileName || '';

          // Co-locate CSS & CSS maps with their `[name]`
          if (file.endsWith('.css') || file.endsWith('.css.map')) {
            return file.replace(/__style(?=\.css(\.map)?$)/, '');
          }

          // Everything else (images/fonts) go in a stable folder.
          return 'assets/[name][extname]';
        },
      },
    },
  },

  // Top-level dev server config
  server: {
    watch: { usePolling: false },
  },
});
