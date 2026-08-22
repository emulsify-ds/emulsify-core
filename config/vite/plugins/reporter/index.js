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
 *  - A `config.build.watch` check selects the full develop summary. One-shot
 *    production builds remain silent unless the collector has an asset problem
 *    or a Sass tally that would otherwise be hidden.
 *
 * Storybook dev stays out of the reporter path and keeps its own ready box;
 * standalone Storybook builds receive the compact diagnostics they need.
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
import {
  hasCycleFailure,
  renderAssetSummary,
  renderBanner,
  renderDeprecationSummary,
  renderRebuild,
  renderSummary,
} from './render.js';
import {
  createStyler,
  displayPath,
  pluralize,
  supportsColor,
  supportsUnicode,
} from './format.js';
import {
  buildInputFileRows,
  buildInputRows,
  buildOutputFileRows,
  buildOutputSummaryRows,
  diffFingerprints,
  fingerprintBundle,
  summarizeBundle,
  watchedRootLabel,
} from './source-roots.js';
import {
  STRICTNESS,
  countStrictAssetFailures,
  resolveAssetStrictness,
} from './strict-mode.js';
import { isDetailed } from './verbosity.js';
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
 * Render one strict-mode asset failure with the stylesheet that imported it.
 *
 * @param {{url: string, rewritten?: string, importer?: string}} entry - Asset diagnostic.
 * @param {string} [projectDir] - Project root used to shorten the importer.
 * @returns {string} One actionable failure line.
 */
const strictAssetFailureLine = (entry, projectDir) => {
  const rewrite = entry.rewritten ? ` -> ${entry.rewritten}` : '';
  return `  ${entry.url}${rewrite} (imported by ${displayPath(entry.importer, projectDir)})`;
};

/**
 * Explain every CSS asset URL that strict mode is rejecting.
 *
 * Level 1 includes only URLs that remained unresolved. Level 2 also includes
 * URLs repaired by the build and ambiguous asset-root matches; keeping those
 * in separate sections avoids describing a successful repair as unresolved.
 *
 * @param {{unresolvedAssets?: object[], assetRebases?: object[]}} snapshot - Diagnostics snapshot.
 * @param {string} strictness - One of {@link STRICTNESS}.
 * @param {string} [projectDir] - Project root used to shorten importers.
 * @param {Array<{where?: string, url?: string}>} [assetRows] - Resolved source locations for notices without an importer.
 * @returns {string} Complete build failure message.
 */
const strictAssetFailureMessage = (
  snapshot,
  strictness,
  projectDir,
  assetRows = [],
) => {
  const unresolved = snapshot.unresolvedAssets || [];
  const rebases =
    strictness === STRICTNESS.all ? snapshot.assetRebases || [] : [];
  const repaired = rebases.filter((entry) => entry.status === 'rebased');
  const ambiguous = rebases.filter((entry) => entry.status !== 'rebased');
  const lines = ['Emulsify: strict CSS asset checks failed.'];

  if (unresolved.length) {
    const unresolvedLines = unresolved.flatMap((entry) => {
      if (entry.importer) return [strictAssetFailureLine(entry, projectDir)];

      const sourceRows = assetRows.filter(
        (row) => row.url === entry.url && row.where && row.where !== '—',
      );
      if (!sourceRows.length) {
        return [strictAssetFailureLine(entry, projectDir)];
      }

      return sourceRows.map((row) =>
        strictAssetFailureLine({ ...entry, importer: row.where }, projectDir),
      );
    });

    lines.push(
      `${pluralize(unresolved.length, 'CSS asset URL')} did not resolve:`,
      ...unresolvedLines,
    );
  }

  if (repaired.length) {
    lines.push(
      `${pluralize(repaired.length, 'CSS asset URL')} ${repaired.length === 1 ? 'was' : 'were'} repaired during the build:`,
      ...repaired.map((entry) => strictAssetFailureLine(entry, projectDir)),
    );
  }

  if (ambiguous.length) {
    lines.push(
      `${pluralize(ambiguous.length, 'CSS asset URL')} matched multiple asset roots:`,
      ...ambiguous.map((entry) => strictAssetFailureLine(entry, projectDir)),
    );
  }

  lines.push('Set EMULSIFY_STRICT_ASSETS=0 to report without failing.');
  return lines.join('\n');
};

/**
 * Merge filesystem copy events into Rollup's bundle-derived output diff.
 *
 * Twig, component metadata, and static source assets are written by plugins
 * after Rollup has produced its bundle, so they can never appear in that
 * bundle's fingerprints. The event map is last-write-wins per path: a future
 * safe prune can mark a path removed, while a later write in the same cycle
 * can restore it.
 *
 * @param {Array<{fileName: string, bytes?: number, gzipBytes?: number}>} changed - Bundle outputs whose bytes changed.
 * @param {string[]} removed - Bundle outputs no longer present.
 * @param {Map<string, {kind: 'written'|'removed', bytes?: number}>} copyChanges - Successful copied-output mutations.
 * @returns {{changedOutputs: Array<{fileName: string, bytes?: number, gzipBytes?: number}>, removedOutputs: string[]}} Combined output diff.
 */
const mergeCopiedOutputChanges = (changed, removed, copyChanges) => {
  const changedByName = new Map(
    changed.map((entry) => [entry.fileName, entry]),
  );
  const removedNames = new Set(removed);

  for (const [fileName, change] of copyChanges) {
    if (change?.kind === 'removed') {
      changedByName.delete(fileName);
      removedNames.add(fileName);
      continue;
    }

    if (change?.kind !== 'written') continue;

    removedNames.delete(fileName);
    changedByName.set(fileName, {
      fileName,
      bytes: Number.isFinite(change.bytes) ? change.bytes : undefined,
    });
  }

  return {
    changedOutputs: [...changedByName.values()].sort((a, b) => {
      const aBytes = Number.isFinite(a.bytes) ? a.bytes : -1;
      const bBytes = Number.isFinite(b.bytes) ? b.bytes : -1;
      return bBytes - aBytes || a.fileName.localeCompare(b.fileName, 'en');
    }),
    removedOutputs: [...removedNames].sort((a, b) => a.localeCompare(b, 'en')),
  };
};

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
 *   detailed?: boolean,
 *   unchangedOutputs?: Set<string>,
 *   copiedOutputChanges?: Map<string, {kind: 'written'|'removed', bytes?: number}>,
 *   version?: string
 * }} options - Plugin options. `unchangedOutputs` carries the files the stable
 *   output plugin dropped from this cycle's bundle because the bytes on disk
 *   already matched. `copiedOutputChanges` carries successful writes and
 *   removals that never enter Rollup's bundle.
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
  detailed,
  strictness,
  unchangedOutputs = new Set(),
  copiedOutputChanges = new Map(),
  version,
} = {}) {
  const styler = createStyler(
    colorEnabled === undefined ? supportsColor() : colorEnabled,
  );
  const unicode =
    unicodeEnabled === undefined ? supportsUnicode() : unicodeEnabled;
  const verbose = detailed === undefined ? isDetailed() : detailed;
  const strictLevel =
    strictness === undefined ? resolveAssetStrictness() : strictness;

  let watching = false;
  let oneShot = false;
  let oneShotPrinted = false;
  let oneShotAssetRows = [];
  let outDir = 'dist';
  let outputRows = [];
  let inputRows = [];
  let inputFiles = [];
  let watchLabel;
  let cycleStart = 0;
  let cyclePrinted = true;
  let firstCycleComplete = false;
  let previousCycleFailed = false;
  let changedFiles = [];
  let writeTally;
  let outputFiles = [];
  let changedOutputs = [];
  let removedOutputs = [];
  let fingerprints = new Map();
  let outputNames = new Set();
  let transformedModules = new Set();

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
    const failed = hasCycleFailure(snapshot);

    // Enriching costs a filesystem read per stylesheet, so it only runs when
    // the cycle actually produced something to attribute. A resolver is built
    // per cycle so its read cache never serves stale contents after an edit.
    //
    // Rebuilds need this too, not just the first build: a rebuild that fails on
    // a missing Sass import has to name the import, and that attribution is
    // what turns "rebuild failed" into something actionable.
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
    const sharedDirectory = sharedMissingDirectory(importRows, env.projectDir);
    const importErrors = {
      rows: importRows,
      sharedDirectory,
      directoryExists: Boolean(
        sharedDirectory &&
        env.projectDir &&
        existsSync(join(env.projectDir, sharedDirectory)),
      ),
    };

    // The minifier reports against generated CSS, so the only route back to
    // a source file is searching for the literals in the offending rule.
    const syntaxErrors = resolver
      ? snapshot.syntaxErrors.map((error) => ({
          ...error,
          lead: findLikelySource(error.declaration, resolver),
        }))
      : snapshot.syntaxErrors;

    if (firstCycleComplete) {
      emit(
        renderRebuild({
          snapshot,
          durationMs,
          changedFiles,
          projectDir: env.projectDir,
          outDir,
          sourceGlob: resolveSourceGlob(env),
          assetRows,
          importErrors,
          syntaxErrors,
          recovered: previousCycleFailed && !failed,
          moduleCount: verbose ? transformedModules.size : undefined,
          changedOutputs,
          removedOutputs,
          detailed: verbose,
          unicode,
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
          outputRows,
          projectDir: env.projectDir,
          sourceGlob: resolveSourceGlob(env),
          assetRows,
          syntaxErrors,
          importErrors,
          platform: env.platform,
          inputRows,
          watchLabel,
          write: writeTally,
          inputFiles,
          outputFiles,
          unicode,
          styler,
        }),
      );
    }

    previousCycleFailed = failed;
    changedFiles = [];
  };

  /**
   * Report collected diagnostics after a one-shot build.
   *
   * Watch builds get the full per-cycle summary; a one-shot `vite build` or
   * `storybook build` gets this and nothing else, and only when there is
   * something to say. It covers both captured asset diagnostics and Sass
   * deprecations swallowed by Storybook's quiet logger.
   *
   * @returns {void}
   */
  const reportOneShot = () => {
    if (!oneShot || oneShotPrinted) return;
    oneShotPrinted = true;

    const snapshot = diagnostics.snapshot();
    const rebases = snapshot.assetRebases || [];
    const deprecations = snapshot.deprecations || [];
    if (
      !snapshot.unresolvedAssets.length &&
      !rebases.length &&
      !deprecations.length
    ) {
      return;
    }

    // Enriching walks the project, so it only runs when there is an unresolved
    // URL to attribute. Rebase records already carry their own importer.
    const resolver = snapshot.unresolvedAssets.length
      ? createAssetResolver(env)
      : undefined;
    oneShotAssetRows = resolver
      ? buildAssetRows(snapshot.unresolvedAssets, resolver)
      : [];

    emit([
      ...renderAssetSummary({
        assetRows: oneShotAssetRows,
        rebases,
        styler,
      }),
      ...renderDeprecationSummary({
        snapshot,
        projectDir: env.projectDir,
        sourceGlob: resolveSourceGlob(env),
        styler,
      }),
    ]);
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
      // Everything below is watch-only setup. A one-shot build stays silent
      // unless it has an asset problem or a collected Sass tally to report.
      oneShot = !watching;
      if (!watching) return;

      outDir = config.build?.outDir || 'dist';
      outputRows = buildOutputSummaryRows({
        outDir,
        mirrorComponentOutput: env.projectStructure?.mirrorComponentOutput,
        componentOutput: env.projectStructure?.output?.components,
      });

      // Attribution is resolved here, from the entry map the config already
      // carries, so the summary can name each source root and what it
      // contributed without touching the filesystem.
      inputRows = buildInputRows({
        entries: config.build?.rollupOptions?.input,
        sourceRootRecords: env.projectStructure?.sourceRootRecords,
        globalRootDirectories: env.projectStructure?.globalRoots,
        projectDir: env.projectDir,
      });

      // Named from the resolved source roots rather than the input rows, so the
      // label is the truth about what Rollup is watching even when a root
      // produced no entries to report.
      watchLabel = watchedRootLabel({
        sourceRootRecords: env.projectStructure?.sourceRootRecords,
        projectDir: env.projectDir,
      });

      // One stat per entry, once, and only when the listing will be printed.
      if (verbose) {
        inputFiles = buildInputFileRows({
          entries: config.build?.rollupOptions?.input,
          projectDir: env.projectDir,
        });
      }

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
      transformedModules = new Set();
      changedOutputs = [];
      removedOutputs = [];
      copiedOutputChanges.clear();
    },

    // Rolldown's own `N modules transformed.` count is unavailable here by
    // design: it comes from Rust instrumentation that Vite only registers when
    // `logLevel` admits info, and keeping the level low is what removes the
    // colliding progress line. Counting the ids that reach this hook is
    // equivalent for the question being asked — what did this cycle recompile —
    // and it costs one Set insert per module. The hook is only attached in
    // detailed mode so the default path is untouched.
    ...(verbose
      ? {
          transform(_code, id) {
            if (watching) transformedModules.add(id);
            return null;
          },
        }
      : {}),

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
    writeBundle: {
      // Copy and mirror hooks publish outside Rollup's bundle. Waiting for all
      // normal-order hooks makes their filesystem events and diagnostics a
      // hard input to this cycle's verdict, even if a producer later becomes
      // asynchronous.
      order: 'post',
      sequential: true,
      handler(_options, bundle) {
        if (watching) {
          writeTally = summarizeBundle(bundle);
          outputRows = buildOutputSummaryRows({
            bundle,
            outDir,
            mirrorComponentOutput: env.projectStructure?.mirrorComponentOutput,
            componentOutput: env.projectStructure?.output?.components,
          });

          // Quiet mode does not hash output contents, but it still keeps the
          // path set needed to identify removals. Carry stable skipped outputs
          // forward just as the detailed fingerprint diff does below.
          if (!verbose) {
            const currentOutputNames = new Set(Object.keys(bundle || {}));
            for (const fileName of unchangedOutputs) {
              if (outputNames.has(fileName)) currentOutputNames.add(fileName);
            }

            if (firstCycleComplete) {
              removedOutputs = [...outputNames].filter(
                (fileName) => !currentOutputNames.has(fileName),
              );
            }
            outputNames = currentOutputNames;
          }

          if (verbose) {
            // Rollup regenerates the whole bundle every cycle, so the first
            // build lists everything and later cycles list only what came out
            // different. Gzip is computed for the full listing once, then only
            // for the files a rebuild changed — which is what keeps the watch
            // loop from paying Rolldown's `computing gzip size...` pause on
            // every keystroke.
            const current = fingerprintBundle(bundle);

            // A file the stable-output plugin dropped is still on disk with the
            // same bytes, so carry its fingerprint forward. Without this the
            // diff below sees it missing from the bundle and calls it removed.
            for (const fileName of unchangedOutputs) {
              const previous = fingerprints.get(fileName);
              if (previous !== undefined) current.set(fileName, previous);
            }

            if (firstCycleComplete) {
              const diff = diffFingerprints(fingerprints, current);
              const changed = new Set(diff.changed);

              changedOutputs = buildOutputFileRows(
                Object.fromEntries(
                  Object.entries(bundle).filter(([fileName]) =>
                    changed.has(fileName),
                  ),
                ),
              );
              removedOutputs = diff.removed;
            } else {
              outputFiles = buildOutputFileRows(bundle);
            }

            fingerprints = current;
          }

          ({ changedOutputs, removedOutputs } = mergeCopiedOutputChanges(
            changedOutputs,
            removedOutputs,
            copiedOutputChanges,
          ));
        }

        reportCycle();
      },
    },

    closeBundle() {
      reportCycle();
      // Printed from here, not writeBundle, so the block lands after Rolldown's
      // own asset table rather than in the middle of it.
      reportOneShot();

      const snapshot = diagnostics.snapshot();
      const strictFailures = countStrictAssetFailures(snapshot, strictLevel);
      if (!oneShot || strictLevel === STRICTNESS.off || !strictFailures) return;

      // Not `process.exitCode`: `storybook build` ends with `process.exit(0)`
      // in a commander postAction hook, which discards it. Rejecting the build
      // is the only signal both runners honor. `closeBundle` also runs after
      // mirrorComponentsToRoot's writeBundle, so a strict failure can never
      // leave a half-mirrored tree behind.
      const error = new Error(
        strictAssetFailureMessage(
          snapshot,
          strictLevel,
          env.projectDir,
          oneShotAssetRows,
        ),
      );
      error.stack = error.message;
      throw error;
    },
  };
}
