/**
 * @file Vite configuration for Emulsify.
 * @see https://vite.dev/config/
 *
 * @overview
 * This configuration wires Emulsify's Vite build in a few clear steps:
 *
 *  1. Resolve the build environment (paths, platform flags) via {@link resolveEnvironment}.
 *  2. Build the Rollup/Vite entries map with {@link buildInputs}.
 *  3. Load optional project extensions (extra plugins and/or a config patcher)
 *     from `config/emulsify-core/vite/plugins.*` via {@link loadProjectExtensions}.
 *  4. Assemble a base Vite config and optionally let the project extend/override
 *     parts of it by returning a patch object from `extendConfig(...)`.
 *
 * Notes:
 * - CSS & JS sourcemaps are enabled.
 * - CSS assets keep their path and drop the internal `__style` suffix if present.
 */

import { defineConfig, mergeConfig } from 'vite';
import path from 'node:path';

import { resolveEnvironment } from './environment.js';
import { makePlugins } from './plugins.js';
import { buildInputs } from './entries.js';
import { loadProjectExtensions } from './project-extensions.js';
import { mergeReactSingletonResolve } from './utils/react-singleton.js';

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
   * @property {string[]} [structureRoots] - Override roots, if provided.
   * @property {object} [platformAdapter] - Active platform behavior adapter.
   */

  /** @type {EmulsifyEnv} */
  const env = resolveEnvironment();

  // Build the Rollup/Vite entry map: keys encode output paths, values source files.
  /** @type {Record<string, string>} */
  const entries = buildInputs({
    projectDir: env.projectDir,
    srcDir: env.srcDir,
    srcExists: env.srcExists,
    isDrupal: env.platform === 'drupal',
    SDC: env.SDC,
    structureOverrides: env.structureOverrides,
    structureRoots: env.structureRoots,
    structureImplementations: env.structureImplementations,
    projectStructure: env.projectStructure,
  });

  // Load optional project-provided plugins and config patches.
  /**
   * @type {{
   *   projectPlugins: import('vite').PluginOption[],
   *   extendConfig?: (base: import('vite').UserConfig, ctx: { env: EmulsifyEnv }) => import('vite').UserConfig
   * }}
   */
  const { projectPlugins, extendConfig } = await loadProjectExtensions({ env });

  // Assemble the base config before applying project extensions.
  /** @type {import('vite').UserConfig} */
  const base = {
    // Treat the current working directory as the root.
    root: process.cwd(),

    // Core plugin set + project-provided plugins (if any).
    plugins: [...makePlugins(env), ...projectPlugins],

    // Keep React-based story helpers on the consumer project's React singleton.
    resolve: mergeReactSingletonResolve(),

    // Generate CSS sourcemaps in dev; JS sourcemaps are set in `build.sourcemap`.
    css: {
      devSourcemap: true,
    },

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
              // Drop the CSS key suffix used to avoid JS/CSS entry collisions.
              return file.replace(/__style(?=\.css$)/, '');
            }
            const [original] = Array.isArray(assetInfo.originalFileNames)
              ? assetInfo.originalFileNames
              : assetInfo.originalFileName
                ? [assetInfo.originalFileName]
                : [];
            if (original) {
              const normalizedOriginal = path.normalize(original);
              const relativeToProject = path.isAbsolute(normalizedOriginal)
                ? path.relative(env.projectDir, normalizedOriginal)
                : normalizedOriginal.replace(/^[/\\]+/, '');
              const normalizedRelative = relativeToProject
                .split(path.sep)
                .join('/');
              // Prevent traversing above dist/ if a relative path climbs directories.
              const safePath = normalizedRelative.startsWith('..')
                ? normalizedRelative.replace(/^(\.\.\/)+/g, '')
                : normalizedRelative;
              if (safePath) {
                return safePath;
              }
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

  // Let project extensions patch the final Vite config.
  /** @type {import('vite').UserConfig} */
  const patched =
    typeof extendConfig === 'function'
      ? mergeConfig(base, extendConfig(base, { env }) || {})
      : base;

  return patched;
});
