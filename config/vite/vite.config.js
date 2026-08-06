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
import {
  createReporterLogger,
  isVerbose,
} from './plugins/reporter/vite-logger.js';
import { isWatchInvocation } from './plugins/reporter/watch-mode.js';
import { loadProjectExtensions } from './project-extensions.js';
import { mergeReactSingletonResolve } from './utils/react-singleton.js';

export default defineConfig(async ({ command } = {}) => {
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
  // fixture verifications keep their existing output untouched.
  const watching = isWatchInvocation();

  // The collector itself is a handful of Maps, and one-shot builds need one
  // too: an unresolved CSS asset URL used to print a single raw Vite line and
  // exit 0, so a broken asset path shipped through CI unnoticed. The reporter
  // plugin decides whether to speak, and for a one-shot build it stays silent
  // unless there is an asset problem — a clean project's output is unchanged.
  const diagnostics = createDiagnosticsCollector();
  const envWithSourceFileIndex = { ...env, sourceFileIndex, diagnostics };

  // `vite build` and `vite build --watch` both resolve `command: 'build'`.
  // Storybook pins `serve` for both of its commands, so it keeps Vite's own
  // logger and never has its notices swallowed by a reporter that will not run.
  const captureViteNotices = !watching && command === 'build' && !isVerbose();

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

    // Quieting `develop` takes two independent switches, because the output has
    // two independent sources.
    //
    // 1. `logLevel` gates Vite's build reporter, which is a native Rolldown
    //    plugin. Vite reads `config.logLevel` directly when constructing it and
    //    passes a `logInfo` callback only when the level admits info. Rolldown's
    //    Rust side registers its Transform, BuildStart, BuildEnd, RenderChunk,
    //    WriteBundle, and GenerateBundle hooks only when that callback exists,
    //    so raising the level does not merely hide the report — it stops
    //    Rolldown instrumenting transforms and computing gzip sizes at all.
    //    That removes the `transforming (N)` progress line, `N modules
    //    transformed.`, `rendering chunks...`, `computing gzip size...`, and the
    //    per-file asset table, and makes every rebuild cheaper.
    //
    //    The progress line is the one that matters most for legibility: Rolldown
    //    writes it from Rust with a `\x1b[2K\r` prefix and no trailing newline,
    //    which is what collides with Storybook's output when `concurrently`
    //    merges both streams onto one pipe. Nothing on the JavaScript side can
    //    intercept it, so `logLevel` is the only lever that removes it.
    //
    // 2. `customLogger` gates Vite's own JavaScript chatter — `building client
    //    environment...`, `build started...`, `watching for file changes...`,
    //    and `built in Nms.` — and routes unresolved CSS asset URLs into the
    //    diagnostics collector so they are summarized rather than printed
    //    mid-build. The reporter writes straight to stdout rather than through
    //    this logger, so its own output survives the higher level, and warnings
    //    and errors still come through.
    //
    // Neither switch substitutes for the other: `createLogger` returns a
    // supplied `customLogger` verbatim and never consults the level, while the
    // build reporter consults the level and never consults the logger.
    // `build.reportCompressedSize` is deliberately left alone; it suppresses
    // only the gzip column, and the table it belongs to is already gone.
    //
    // A one-shot build takes only the second switch. `logLevel: 'warn'` is what
    // stops Rolldown instrumenting transforms, so setting it there would delete
    // the module count and the per-file asset table from `npm run build` — the
    // one command whose output people actually read. The comment above already
    // establishes the two are independent, and this relies on that: the logger
    // captures the unresolved-URL notices, the reporter prints them back as one
    // block, and Rolldown's report is untouched.
    ...(watching
      ? {
          logLevel: isVerbose() ? 'info' : 'warn',
          customLogger: createReporterLogger(
            diagnostics,
            createLogger(isVerbose() ? 'info' : 'warn'),
          ),
        }
      : captureViteNotices
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
      ...(watching
        ? { preprocessorOptions: { scss: createSassOptions(diagnostics) } }
        : {}),
    },

    build: {
      // Clean the output directory before building. Vite re-empties it on every
      // watch rebuild, not just the first, which rewrites stylesheets no edit
      // touched; `stableWatchOutputPlugin` turns that off once the develop
      // loop's first cycle has produced a clean tree.
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
