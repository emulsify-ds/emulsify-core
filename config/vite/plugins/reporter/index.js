/**
 * @file Develop reporter plugin for Emulsify.
 *
 * Replaces the interleaved Vite/Sass output of `npm run develop` with a short
 * banner, one summary per build cycle, and a single line per rebuild.
 *
 * ## Why this plugin is scoped so narrowly
 *
 * `makePlugins()` is consumed twice during `npm run develop`: once by the Vite
 * watcher, and once by Storybook, whose `viteFinal` spreads the shared plugin
 * array into its own config. A reporter that printed unconditionally would emit
 * its banner from both processes.
 *
 * Two guards prevent that:
 *
 *  - `apply: 'build'` excludes Storybook's dev server, which resolves with
 *    `command: 'serve'`. This mirrors the existing guard on the component
 *    mirror plugin.
 *  - A `config.build.watch` check excludes `storybook build`, `npm run build`,
 *    and every fixture verification, all of which run a one-shot production
 *    build where `--watch` is absent. Those commands keep their current output
 *    byte for byte.
 *
 * The net effect is that the reporter only speaks for the long-running watcher
 * started by `develop`, and Storybook keeps printing its own ready box.
 */

import { join, relative } from 'node:path';

import { existsSync } from 'node:fs';

import {
  buildAssetRows,
  buildImportRows,
  createAssetResolver,
  findLikelySource,
  sharedMissingDirectory,
} from './asset-resolver.js';
import { classifyBuildError } from './build-errors.js';
import { renderBanner, renderRebuild, renderSummary } from './render.js';
import { createStyler, supportsColor, supportsUnicode } from './format.js';
import { buildInputRows, summarizeBundle } from './source-roots.js';
import { resolvePackageVersion } from '../../utils/package-version.js';

/**
 * Build the stylesheet glob handed to `sass-migrator`.
 *
 * The migrator takes entrypoints and the docs recommend passing every
 * stylesheet in the package, so a glob rooted at the project's source
 * directory is both valid and copy-pasteable. Falling back to `src` keeps the
 * command sensible when the source directory cannot be resolved.
 *
 * @param {{projectDir?: string, srcDir?: string}} env - Project environment.
 * @returns {string} Glob relative to the project root.
 */
export function resolveSourceGlob({ projectDir, srcDir } = {}) {
  if (!projectDir || !srcDir) return 'src/**/*.scss';

  const relativeSrc = relative(projectDir, srcDir).split('\\').join('/');
  if (!relativeSrc || relativeSrc.startsWith('..')) return 'src/**/*.scss';

  return `${relativeSrc}/**/*.scss`;
}

/**
 * Count the entries in a resolved Rollup input option.
 *
 * @param {string|string[]|Record<string, string>|undefined} input - Rollup input.
 * @returns {number|undefined} Entry count, when determinable.
 */
export function countEntries(input) {
  if (!input) return undefined;
  if (typeof input === 'string') return 1;
  if (Array.isArray(input)) return input.length;
  if (typeof input === 'object') return Object.keys(input).length;
  return undefined;
}

/**
 * Create the Emulsify develop reporter plugin.
 *
 * @param {{
 *   env: {projectDir?: string, platform?: string},
 *   diagnostics: ReturnType<import('./diagnostics.js').createDiagnosticsCollector>,
 *   write?: (line: string) => void,
 *   now?: () => number,
 *   clock?: () => Date,
 *   colorEnabled?: boolean,
 *   version?: string
 * }} options - Plugin options.
 * @returns {import('vite').PluginOption} Develop reporter plugin.
 */
export function developReporterPlugin({
  env = {},
  diagnostics,
  write = (line) => process.stdout.write(`${line}\n`),
  now = () => Date.now(),
  clock = () => new Date(),
  colorEnabled,
  unicodeEnabled,
  version,
} = {}) {
  const styler = createStyler(
    colorEnabled === undefined ? supportsColor() : colorEnabled,
  );
  const unicode =
    unicodeEnabled === undefined ? supportsUnicode() : unicodeEnabled;

  let watching = false;
  let outDir = 'dist';
  let inputRows = [];
  let cycleStart = 0;
  let cyclePrinted = true;
  let firstCycleComplete = false;
  let changedFiles = [];
  let writeTally;

  /**
   * Write an array of finished lines to the destination stream.
   *
   * @param {string[]} lines - Lines to emit.
   * @returns {void}
   */
  const emit = (lines) => lines.forEach((line) => write(line));

  /**
   * Unpack a build failure and record everything it contains.
   *
   * Rolldown wraps every failure of a cycle into one error whose message is
   * just a count, so it has to be opened up before anything useful can be
   * reported. Shared by the build and generate phases, which fail through
   * different hooks but produce the same shapes.
   *
   * @param {Error} error - Build or render error.
   * @returns {void}
   */
  const captureFailure = (error) => {
    const { importErrors, syntaxErrors, otherErrors } =
      classifyBuildError(error);

    for (const importError of importErrors) {
      diagnostics.recordImportError(importError);
    }

    for (const syntaxError of syntaxErrors) {
      diagnostics.recordSyntaxError(syntaxError);
    }

    const detailed = importErrors.length > 0 || syntaxErrors.length > 0;

    for (const other of otherErrors) {
      // The aggregate wrapper carries no location and would only add a row
      // reading "Build failed with N errors" above the detail it wraps.
      if (detailed && /^Build failed with \d+ error/.test(other.message)) {
        continue;
      }
      diagnostics.recordError(other);
    }
  };

  /**
   * Print the summary or rebuild line for the cycle that just finished.
   *
   * Guarded so the cycle reports exactly once regardless of whether Rollup
   * reaches `writeBundle`, `closeBundle`, or neither after a failure.
   *
   * @returns {void}
   */
  const reportCycle = () => {
    if (!watching || cyclePrinted) return;
    cyclePrinted = true;

    const snapshot = diagnostics.snapshot();
    const durationMs = now() - cycleStart;

    if (firstCycleComplete) {
      emit(
        renderRebuild({
          snapshot,
          durationMs,
          changedFiles,
          projectDir: env.projectDir,
          styler,
          now: clock(),
        }),
      );
    } else {
      firstCycleComplete = true;
      // Enriching costs a filesystem read per stylesheet, so it only runs when
      // the build actually produced unresolved URLs. A resolver is built per
      // cycle so its read cache never serves stale contents after an edit.
      const needsResolver =
        snapshot.unresolvedAssets.length > 0 ||
        snapshot.importErrors.length > 0 ||
        snapshot.syntaxErrors.length > 0;
      const resolver = needsResolver ? createAssetResolver(env) : undefined;

      const assetRows = resolver
        ? buildAssetRows(snapshot.unresolvedAssets, resolver)
        : [];

      const importRows = resolver
        ? buildImportRows(snapshot.importErrors, resolver, env.projectDir)
        : [];
      const sharedDirectory = sharedMissingDirectory(
        importRows,
        env.projectDir,
      );

      // The minifier reports against generated CSS, so the only route back to
      // a source file is searching for the literals in the offending rule.
      const syntaxErrors = resolver
        ? snapshot.syntaxErrors.map((error) => ({
            ...error,
            lead: findLikelySource(error.declaration, resolver),
          }))
        : snapshot.syntaxErrors;

      emit(
        renderSummary({
          snapshot,
          durationMs,
          outDir,
          projectDir: env.projectDir,
          sourceGlob: resolveSourceGlob(env),
          assetRows,
          syntaxErrors,
          importErrors: {
            rows: importRows,
            sharedDirectory,
            directoryExists: Boolean(
              sharedDirectory &&
              env.projectDir &&
              existsSync(join(env.projectDir, sharedDirectory)),
            ),
          },
          platform: env.platform,
          inputRows,
          write: writeTally,
          unicode,
          styler,
        }),
      );
    }

    changedFiles = [];
  };

  return {
    name: 'emulsify-develop-reporter',

    // Storybook's dev server resolves as `serve`, so this keeps the reporter
    // out of the Storybook process entirely.
    apply: 'build',

    // Report after the plugins that actually produce diagnostics have run.
    enforce: 'post',

    configResolved(config) {
      watching = Boolean(config.build?.watch);
      if (!watching) return;

      outDir = config.build?.outDir || 'dist';

      // Attribution is resolved here, from the entry map the config already
      // carries, so the summary can name each source root and what it
      // contributed without touching the filesystem.
      inputRows = buildInputRows({
        entries: config.build?.rollupOptions?.input,
        sourceRootRecords: env.projectStructure?.sourceRootRecords,
        globalRootDirectories: env.projectStructure?.globalRoots,
        projectDir: env.projectDir,
      });

      emit(
        renderBanner({
          version: version || resolvePackageVersion(env.projectDir),
          unicode,
          styler,
        }),
      );
    },

    buildStart() {
      if (!watching) return;
      diagnostics.reset();
      cycleStart = now();
      cyclePrinted = false;
    },

    watchChange(id) {
      if (!watching) return;
      changedFiles.push(id);
    },

    buildEnd(error) {
      if (!watching || !error) return;
      captureFailure(error);
      // A failed cycle never reaches writeBundle, so report from here instead.
      reportCycle();
    },

    // Failures while generating output — CSS minification among them — occur
    // after `buildEnd` and abort before `writeBundle`, so without this hook a
    // broken build produced no summary at all. It also stops a later
    // `closeBundle` from reporting success over a build that failed.
    renderError(error) {
      if (!watching || !error) return;
      captureFailure(error);
      reportCycle();
    },

    // The bundle is reduced here rather than in the summary because this is the
    // only hook that receives it. Raising `logLevel` to quiet the develop loop
    // discards Rolldown's per-file asset table, and this recovers the three
    // facts from it worth keeping.
    writeBundle(_options, bundle) {
      if (watching) writeTally = summarizeBundle(bundle);
      reportCycle();
    },

    closeBundle() {
      reportCycle();
    },
  };
}
