/**
 * @file Vite configuration for Emulsify.
 * @description
 * - Resolves the project environment (paths, platform flags).
 * - Builds a Rollup input map keyed to desired output paths.
 * - Configures Vite/Rollup outputs so files land using the `[name]` key.
 * - Normalizes generated CSS filenames by stripping a helper suffix (`__style`).
 */

import { defineConfig } from 'vite';

import { resolveEnvironment } from './environment.js';
import { makePlugins } from './plugins.js';
import { buildInputs, makePatterns } from './entries.js';

/**
 * @typedef {Object} EmulsifyEnvironment
 * @property {string} projectDir  Absolute project root.
 * @property {string} srcDir      Absolute path to the source directory (usually `src/`).
 * @property {boolean} srcExists  Whether `src/` exists (affects routing).
 * @property {boolean} isDrupal   Whether the target platform is Drupal.
 * @property {boolean} SDC        Single-Directory Components mode toggle.
 */

/** @type {EmulsifyEnvironment} */
const env = resolveEnvironment();

/**
 * Build the set of glob patterns used to discover entry files.
 * Keeping discovery logic isolated makes this file small and readable.
 */
const patterns = makePatterns({
  projectDir: env.projectDir,
  srcDir: env.srcDir,
  srcExists: env.srcExists,
  isDrupal: env.isDrupal,
  SDC: env.SDC,
});

/**
 * Construct a Rollup input map where:
 *  - keys are *output* path stems (used as `[name]`)
 *  - values are absolute input file paths
 * This lets us control final output locations strictly via `[name]`.
 * @type {Record<string, string>}
 */
const entries = buildInputs(
  {
    projectDir: env.projectDir,
    srcDir: env.srcDir,
    srcExists: env.srcExists,
    isDrupal: env.isDrupal,
    SDC: env.SDC,
  },
  patterns,
);

export default defineConfig({
  /**
   * Root is the current working directory. Adjust if you run Vite
   * from a different location than the project root.
   */
  root: process.cwd(),

  /**
   * Plugins (Twig, YAML, sprites, custom copy/mirror) are built
   * from the environment so they can branch on `srcExists`, `isDrupal`, etc.
   */
  plugins: makePlugins(env),

  /**
   * Generate CSS source maps in dev to aid debugging.
   */
  css: {
    devSourcemap: true,
  },

  /**
   * Vite build configuration.
   */
  build: {
    /**
     * Whether to empty the output directory before building.
     * Set to `true` if `dist/` contains only build artifacts.
     * Leave `false` if you manually place static files there.
     */
    emptyOutDir: true,

    /**
     * Output directory. Trailing slash is accepted by Vite; keep consistent
     * with any custom plugins that read this value.
     */
    outDir: 'dist/',

    /** Emit source maps for JS/CSS. */
    sourcemap: true,

    /**
     * Rollup-specific options.
     * We pass the generated `entries` map and control filenames
     * using `[name]` which is derived from `entries` keys.
     */
    rollupOptions: {
      /**
       * Keyed input map: { [name]: absolutePath }
       */
      input: entries,

      /**
       * Output naming.
       * - JS: `[name].js` (placed exactly according to the key path)
       * - CSS: `[name].css`, with an extra step to drop the `__style` suffix
       *        used to avoid name collisions in SDC mode.
       */
      output: {
        entryFileNames: '[name].js',

        /**
         * Customize asset names:
         * - Place CSS and CSS sourcemaps next to the CSS file (respect the keyed path).
         * - Strip the __style suffix we used at the key level to avoid name collisions.
         * - Send all other assets to a stable bucket.
         *
         * @param {import('rollup').PreRenderedAsset} assetInfo
         * @returns {string}
         */
        assetFileNames: (assetInfo) => {
          const file = assetInfo.name || assetInfo.fileName || '';

          // Keep CSS and CSS sourcemaps next to the CSS they belong to.
          if (file.endsWith('.css') || file.endsWith('.map')) {
            // Drop the helper suffix for both foo__style.css and foo__style.css.map
            return file.replace(/__style(?=\.css(\.map)?$)/, '');
          }

          // Everything else (images, fonts, etc.) goes under dist/assets/
          return 'assets/[name][extname]';
        },
      },
    },
  },

  /**
   * Dev server configuration.
   * NOTE: This block belongs at the top level (not inside `build`).
   */
  server: {
    /**
     * File watching tweaks.
     * Set `usePolling: true` with an `interval` if you’re on Docker/WSL/NFS
     * and native FS events are unreliable.
     */
    watch: { usePolling: false },
  },
});
