/**
 * @file Vite configuration for Emulsify.
 * @see https://vite.dev/config/
 *
 * @overview
 * This configuration wires Emulsify’s Vite build in a few clear steps:
 *
 *  1. Resolve the build **environment** (paths, platform flags) via {@link resolveEnvironment}.
 *  2. Create the **glob patterns** used to discover inputs with {@link makePatterns}.
 *  3. Build the Rollup/Vite **entries map** with {@link buildInputs}.
 *  4. Load optional **project extensions** (extra plugins and/or a config patcher)
 *     from `.config/emulsify-core/vite/plugins.*` via {@link loadProjectExtensions}.
 *  5. Assemble a base Vite config and (optionally) let the project **extend/override**
 *     parts of it by returning a patch object from `extendConfig(...)`.
 *
 * Notes:
 * - CSS & JS sourcemaps are enabled.
 * - CSS assets keep their path and drop the internal `__style` suffix if present.
 * - The optional project patch uses `mergeConfig`. If your runtime does not already
 *   provide it in scope, add: `import { defineConfig, mergeConfig } from 'vite';`
 */

// import mergeConfig alongside defineConfig:
import { defineConfig, mergeConfig } from 'vite';

import { resolveEnvironment } from './environment.js';
import { makePlugins } from './plugins.js';
import { buildInputs, makePatterns } from './entries.js';
import { loadProjectExtensions } from './project-extensions.js';

export default defineConfig(async () => {
  /**
   * Environment details for this build (project paths, platform, flags).
   * @typedef {Object} EmulsifyEnv
   * @property {string} projectDir - Absolute project root.
   * @property {string} srcDir - Absolute source directory (`src/` if present, otherwise `components/`).
   * @property {boolean} srcExists - Whether `src/` exists in the project.
   * @property {string} platform - Deployment platform (e.g., `"drupal"`).
   * @property {boolean} [SDC] - Single Directory Components toggle, if available.
   * @property {boolean} [structureOverrides] - Whether component structure overrides are enabled.
   * @property {Record<string,string[]>} [structureRoots] - Override roots map, if provided.
   */

  /** @type {EmulsifyEnv} */
  const env = resolveEnvironment();

  // ---------------------------------------------------------------------------
  // 1) Build input discovery patterns (kept separate for readability/testing).
  //    These honor platform & flags like SDC and structure overrides.
  // ---------------------------------------------------------------------------
  /** @type {ReturnType<typeof makePatterns>} */
  const patterns = makePatterns({
    projectDir: env.projectDir,
    srcDir: env.srcDir,
    srcExists: env.srcExists,
    isDrupal: env.platform === 'drupal',
    SDC: env.SDC,
    structureOverrides: env.structureOverrides,
    structureRoots: env.structureRoots,
  });

  // ---------------------------------------------------------------------------
  // 2) Build the Rollup/Vite entry map.
  //    Keys encode output paths; values are absolute source file paths.
  // ---------------------------------------------------------------------------
  /** @type {Record<string, string>} */
  const entries = buildInputs(
    {
      projectDir: env.projectDir,
      srcDir: env.srcDir,
      srcExists: env.srcExists,
      isDrupal: env.platform === 'drupal',
      SDC: env.SDC,
      structureOverrides: env.structureOverrides,
      structureRoots: env.structureRoots,
    },
    patterns,
  );

  // ---------------------------------------------------------------------------
  // 3) Load project-provided extensions:
  //    - `projectPlugins`: extra Vite plugins to append
  //    - `extendConfig(base, { env })`: returns a partial config to merge
  // ---------------------------------------------------------------------------
  /**
   * @type {{
   *   projectPlugins: import('vite').PluginOption[],
   *   extendConfig?: (base: import('vite').UserConfig, ctx: { env: EmulsifyEnv }) => import('vite').UserConfig
   * }}
   */
  const { projectPlugins, extendConfig } = await loadProjectExtensions({ env });

  // ---------------------------------------------------------------------------
  // 4) Assemble the base Vite config (kept minimal & readable on purpose).
  //    Project extensions (if any) are applied *after* this via `extendConfig`.
  // ---------------------------------------------------------------------------
  /** @type {import('vite').UserConfig} */
  const base = {
    // Treat the current working directory as the root.
    root: process.cwd(),

    // Core plugin set + project-provided plugins (if any).
    plugins: [...makePlugins(env), ...projectPlugins],

    // Generate CSS sourcemaps in dev; JS sourcemaps are set in `build.sourcemap`.
    css: { devSourcemap: true },

    build: {
      // Clean the output directory before building.
      emptyOutDir: true,

      // All outputs are written into ./dist/
      outDir: 'dist/',

      // Emit production sourcemaps as well.
      sourcemap: true,

      rollupOptions: {
        // Multi-entry input map constructed above.
        input: entries,

        // Keep file names deterministic and strip the internal CSS key suffix.
        output: {
          entryFileNames: '[name].js',

          /**
           * Decide asset filenames. Normalizes `.css` paths and removes the `__style`
           * suffix used to avoid name collisions in entry keys.
           * @param {import('rollup').PreRenderedAsset} assetInfo
           * @returns {string}
           */
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
    },

    // Dev server tweaks; disable polling by default for performance.
    server: {
      watch: { usePolling: false },
    },
  };

  // ---------------------------------------------------------------------------
  // 5) Allow the project to patch the final Vite config.
  //    If `extendConfig` returns a partial object, merge it into `base`.
  //    (Requires `mergeConfig` from 'vite'; if it isn't imported, add it.)
  // ---------------------------------------------------------------------------
  /** @type {import('vite').UserConfig} */
  const patched =
    typeof extendConfig === 'function'
      ? // @ts-expect-error: ensure `mergeConfig` is imported if not already in scope
        mergeConfig(base, extendConfig(base, { env }) || {})
      : base;

  return patched;
});
