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
 * - JS sourcemaps come from `build.sourcemap`. Extracted CSS gets no map from
 *   `vite build`: `vite:css-post` emits CSS through
 *   `this.emitFile({ type: 'asset' })`, Rollup/Rolldown assets carry no map,
 *   and `finalizeCss()` -> `minifyCSS()` returns code only. To trace a rule
 *   back to its `.scss` partial, let Vite compile the SCSS in Storybook: set
 *   `parameters.emulsify.loadAllCSS = false` in
 *   `config/emulsify-core/storybook/preview.js` and import the SCSS entry
 *   there, so `css.devSourcemap` can chain the map to source. Loading the
 *   compiled CSS instead yields an identity map whose only source is the
 *   compiled `.css` file.
 * - CSS is left unminified during `vite build --watch` so the develop loop
 *   stays readable; one-shot builds keep minification.
 * - CSS assets keep their path and drop the internal `__style` suffix if present.
 */

import { createLogger, defineConfig, mergeConfig } from 'vite';
import path from 'node:path';

import { resolveEnvironment } from './environment.js';
import { makePlugins } from './plugins.js';
import { buildInputs } from './entries.js';
import { createSourceFileIndex } from './plugins/assets/source-file-index.js';
import { createDiagnosticsCollector } from './plugins/reporter/diagnostics.js';
import { createSassOptions } from './plugins/reporter/sass-logger.js';
import { createReporterLogger } from './plugins/reporter/vite-logger.js';
import { isWatchInvocation } from './plugins/reporter/watch-mode.js';
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
  const sourceFileIndex = createSourceFileIndex(env.projectStructure);

  // The develop reporter takes over output only for `vite build --watch`, the
  // watcher `npm run develop` runs. One-shot builds, Storybook, and the release
  // fixture verifications keep their existing output untouched, so no warning
  // is ever collected without also being reported.
  const watching = isWatchInvocation();
  const diagnostics = watching ? createDiagnosticsCollector() : undefined;
  const envWithSourceFileIndex = { ...env, sourceFileIndex, diagnostics };

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
    sourceFileIndex,
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
    plugins: [...makePlugins(envWithSourceFileIndex), ...projectPlugins],

    // Route Vite's own diagnostics through the reporter during a watch build so
    // unresolved CSS asset URLs are summarized rather than printed mid-build.
    ...(diagnostics
      ? { customLogger: createReporterLogger(diagnostics, createLogger()) }
      : {}),

    // Keep React-based story helpers on the consumer project's React singleton.
    resolve: mergeReactSingletonResolve(),

    // Generate CSS sourcemaps in dev; JS sourcemaps are set in `build.sourcemap`.
    // These map only what Vite itself compiles. A preview that imports
    // already-compiled CSS gets an identity map pointing at that `.css` file,
    // so import SCSS entries when styles need to resolve to their partials.
    css: {
      devSourcemap: true,

      // During a watch build, route Sass warnings into the diagnostics
      // collector instead of letting Dart Sass print a formatted block per
      // occurrence. The reporter prints one deduplicated tally per cycle, so
      // the deprecation debt stays visible without the repetition.
      ...(diagnostics
        ? { preprocessorOptions: { scss: createSassOptions(diagnostics) } }
        : {}),
    },

    build: {
      // Clean the output directory before building.
      emptyOutDir: true,

      // All outputs are written into ./dist/
      outDir: 'dist/',

      // Emit JS sourcemaps. Extracted CSS is not covered; see the file header.
      sourcemap: true,

      // Vite cannot map extracted CSS, so during `vite build --watch` the
      // readable stylesheet is the debugging aid: keep it unminified so
      // devtools shows one declaration per line instead of a single long line.
      // One-shot `vite build`, `storybook build`, and the release fixture
      // verifications still minify, so nothing a platform ships changes.
      cssMinify: !watching,

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
