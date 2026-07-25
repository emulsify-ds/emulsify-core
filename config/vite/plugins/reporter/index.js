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

import { renderBanner, renderRebuild, renderSummary } from './render.js';
import { createStyler, supportsColor } from './format.js';
import { resolvePackageVersion } from '../../utils/package-version.js';

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
 * Reduce a Rollup or Vite build error to a single reportable record.
 *
 * Sass failures arrive with the compiler's full source excerpt embedded in the
 * message, and Vite prefixes the responsible plugin. Both are stripped so the
 * summary shows one readable sentence with a location beside it.
 *
 * @param {Error & {loc?: {file?: string, line?: number}, id?: string, plugin?: string}} error - Build error.
 * @returns {{message: string, file: string|undefined, line: number|undefined}} Normalized error.
 */
export function normalizeBuildError(error) {
  if (!error) {
    return { message: 'Unknown build error', file: undefined, line: undefined };
  }

  const rawMessage = typeof error === 'string' ? error : error.message || '';
  const [firstLine] = rawMessage.split('\n');
  const message =
    firstLine?.replace(/^\[[^\]]+\]\s*/, '').trim() || 'Unknown build error';

  return {
    message,
    file: error.loc?.file || error.id || undefined,
    line: error.loc?.line,
  };
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
  version,
} = {}) {
  const styler = createStyler(
    colorEnabled === undefined ? supportsColor() : colorEnabled,
  );

  let watching = false;
  let outDir = 'dist';
  let entryCount;
  let cycleStart = 0;
  let cyclePrinted = true;
  let firstCycleComplete = false;
  let changedFiles = [];

  /**
   * Write an array of finished lines to the destination stream.
   *
   * @param {string[]} lines - Lines to emit.
   * @returns {void}
   */
  const emit = (lines) => lines.forEach((line) => write(line));

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
      emit(
        renderSummary({
          snapshot,
          durationMs,
          outDir,
          projectDir: env.projectDir,
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
      entryCount = countEntries(config.build?.rollupOptions?.input);

      emit(
        renderBanner({
          version: version || resolvePackageVersion(env.projectDir),
          platform: env.platform,
          entryCount,
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
      diagnostics.recordError(normalizeBuildError(error));
      // A failed cycle never reaches writeBundle, so report from here instead.
      reportCycle();
    },

    writeBundle() {
      reportCycle();
    },

    closeBundle() {
      reportCycle();
    },
  };
}
