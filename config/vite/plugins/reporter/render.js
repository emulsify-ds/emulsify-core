/**
 * @file Line rendering for the Emulsify develop reporter.
 *
 * Every function here is pure: it takes a diagnostics snapshot and returns an
 * array of finished lines. Keeping rendering separate from the Vite plugin
 * lifecycle means the output can be asserted directly in tests without running
 * a build, and it enforces the append-only constraint by construction — there
 * is no stream to rewrite, only strings to hand back.
 */

import {
  SYMBOLS,
  displayLocation,
  displayPath,
  formatClockTime,
  formatDuration,
  platformLabel,
  pluralize,
} from './format.js';
import { deprecationFix, deprecationMigrator } from './sass-logger.js';

const INDENT = '  ';
const DETAIL_INDENT = '      ';
const SEPARATOR = ' · ';

/**
 * Maximum number of individual problems listed before collapsing to a count.
 *
 * @type {number}
 */
const MAX_DETAIL_ROWS = 5;

/**
 * Maximum number of unresolved asset URLs listed before collapsing.
 *
 * Higher than the general detail cap because these rows are single short
 * paths, and the same image referenced from two stylesheets with different
 * relative spellings is two separate edits — hiding either is unhelpful.
 *
 * @type {number}
 */
const MAX_ASSET_ROWS = 8;

/**
 * Maximum number of files listed in the deprecation worklist.
 *
 * @type {number}
 */
const MAX_DEPRECATION_FILES = 4;

/**
 * Maximum number of deprecation kinds listed beneath a single file.
 *
 * @type {number}
 */
const MAX_DEPRECATION_KINDS_PER_FILE = 4;

/**
 * Maximum number of line numbers named on one row before collapsing.
 *
 * @type {number}
 */
const MAX_LINES_PER_ROW = 3;

/**
 * Render the affected line numbers for one deprecation within one file.
 *
 * @param {number[]} lineNumbers - Sorted line numbers.
 * @returns {string} Compact line reference, for example `:30,31 +2`.
 */
export function formatLineList(lineNumbers = []) {
  if (lineNumbers.length === 0) return ':?';

  const shown = lineNumbers.slice(0, MAX_LINES_PER_ROW).join(',');
  const hidden = lineNumbers.length - MAX_LINES_PER_ROW;

  return hidden > 0 ? `:${shown} +${hidden}` : `:${shown}`;
}

/**
 * Half-block wordmark drawn when the terminal can render the glyphs.
 *
 * Spells EMULSIFY at 31 columns, which fits comfortably in an 80-column
 * terminal alongside the two-space indent.
 *
 * @type {string[]}
 */
const WORDMARK = [
  '█▀▀ █▀▄▀█ █ █ █   █▀▀ █ █▀▀ █ █',
  '█▀▀ █ ▀ █ █ █ █   ▀▀█ █ █▀▀ ▀▄▀',
  '▀▀▀ ▀   ▀ ▀▀▀ ▀▀▀ ▀▀▀ ▀ ▀    ▀ ',
];

/**
 * Render the header shown once when the watcher starts.
 *
 * The wordmark exists to mark where Emulsify's output begins. `npm run develop`
 * interleaves npm's script echo, Vite, and Storybook, so a single dim line is
 * easy to scroll past; a block of art is not. Terminals that cannot render the
 * glyphs get the plain name instead of mojibake.
 *
 * @param {{
 *   version?: string,
 *   platform?: string,
 *   entryCount?: number,
 *   unicode?: boolean,
 *   styler: (format: string|string[], text: string) => string
 * }} options - Banner inputs.
 * @returns {string[]} Banner lines.
 */
export function renderBanner({
  version,
  platform,
  entryCount,
  unicode = true,
  styler,
}) {
  const facts = [
    `core ${version || '0.0.0'}`,
    `Platform: ${platformLabel(platform)}`,
  ];

  if (Number.isFinite(entryCount)) {
    facts.push(pluralize(entryCount, 'entry', 'entries'));
  }

  const mark = unicode
    ? WORDMARK.map((row) => `${INDENT}${styler(['bold', 'cyan'], row)}`)
    : [`${INDENT}${styler(['bold', 'cyan'], 'EMULSIFY')}`];

  return ['', ...mark, `${INDENT}${styler('gray', facts.join(SEPARATOR))}`, ''];
}

/**
 * Render the detail rows for a set of errors or warnings.
 *
 * @param {Array<{message?: string, file?: string, line?: number, count: number}>} entries - Reported entries.
 * @param {string} projectDir - Project root.
 * @param {(format: string|string[], text: string) => string} styler - Styling function.
 * @returns {string[]} Detail lines.
 */
function renderDetailRows(entries, projectDir, styler) {
  const lines = [];

  for (const entry of entries.slice(0, MAX_DETAIL_ROWS)) {
    const repeat = entry.count > 1 ? styler('gray', ` (×${entry.count})`) : '';

    if (entry.file) {
      const location = displayLocation(entry.file, entry.line, projectDir);
      lines.push(`${DETAIL_INDENT}${styler('gray', location)}${repeat}`);

      if (entry.message) {
        lines.push(`${DETAIL_INDENT}${entry.message}`);
      }
      continue;
    }

    // Some warnings arrive with no span. Printing a "<unknown>" path row for
    // those wastes a line and reads like a failure to resolve something, so the
    // message carries the repeat count instead. An entry with neither a
    // location nor a message has nothing to act on and is dropped.
    if (entry.message) {
      lines.push(`${DETAIL_INDENT}${entry.message}${repeat}`);
    }
  }

  const hidden = entries.length - MAX_DETAIL_ROWS;
  if (hidden > 0) {
    lines.push(
      `${DETAIL_INDENT}${styler('gray', `+${pluralize(hidden, 'more')}`)}`,
    );
  }

  return lines;
}

/**
 * Render the deduplicated Sass deprecation block.
 *
 * This replaces several hundred lines of repeated Dart Sass output with a
 * worklist: total first, then each affected file with the deprecations inside
 * it, then the command that fixes most of them. Each row carries the affected
 * lines, how many occurrences, the Sass deprecation ID, and the substitution to
 * make — the ID alone identifies nothing actionable, and the substitution alone
 * gives no way to look up the details.
 *
 * @param {object} snapshot - Diagnostics snapshot.
 * @param {string} projectDir - Project root.
 * @param {(format: string|string[], text: string) => string} styler - Styling function.
 * @param {string} sourceGlob - Glob matching the project stylesheets.
 * @returns {string[]} Deprecation summary lines.
 */
function renderDeprecations(snapshot, projectDir, styler, sourceGlob) {
  const { deprecations, deprecationsByFile, deprecationTotal } = snapshot;
  if (deprecations.length === 0) return [];

  const headline = [
    pluralize(deprecationTotal, 'sass deprecation'),
    pluralize(deprecationsByFile.length || 1, 'file'),
  ].join(SEPARATOR);

  const lines = [
    `${INDENT}${styler('yellow', SYMBOLS.warning)} ${styler('yellow', headline)}`,
    '',
  ];

  const shownFiles = deprecationsByFile.slice(0, MAX_DEPRECATION_FILES);

  // Column widths are measured across every row that will be printed so the
  // line, count, and ID columns align and the block scans as a table. Padding
  // is applied before styling so escape sequences never affect the width.
  const rows = shownFiles.flatMap((group) =>
    group.entries.slice(0, MAX_DEPRECATION_KINDS_PER_FILE),
  );
  const lineWidth = Math.max(
    ...rows.map((e) => formatLineList(e.lines).length),
    0,
  );
  const countWidth = Math.max(...rows.map((e) => `${e.count}×`.length), 0);
  const idWidth = Math.max(...rows.map((e) => e.id.length), 0);

  for (const group of shownFiles) {
    lines.push(
      `${DETAIL_INDENT}${styler('cyan', displayPath(group.file, projectDir))}`,
    );

    for (const entry of group.entries.slice(
      0,
      MAX_DEPRECATION_KINDS_PER_FILE,
    )) {
      const lineRef = formatLineList(entry.lines).padEnd(lineWidth);
      const count = `${entry.count}×`.padStart(countWidth);
      const id = entry.id.padEnd(idWidth);
      const fix = deprecationFix(entry.id) || '';

      lines.push(
        `${DETAIL_INDENT}  ${styler('gray', lineRef)}  ${styler('yellow', count)}  ${styler('gray', id)}  ${fix}`.trimEnd(),
      );
    }

    const hiddenKinds = group.entries.length - MAX_DEPRECATION_KINDS_PER_FILE;
    if (hiddenKinds > 0) {
      lines.push(
        `${DETAIL_INDENT}  ${styler('gray', `+${pluralize(hiddenKinds, 'more kind')}`)}`,
      );
    }
  }

  const hiddenFiles = deprecationsByFile.length - MAX_DEPRECATION_FILES;
  if (hiddenFiles > 0) {
    lines.push(
      `${DETAIL_INDENT}${styler('gray', `+${pluralize(hiddenFiles, 'more file')}`)}`,
    );
  }

  const command = renderMigratorCommand(deprecations, sourceGlob, styler);
  if (command) {
    lines.push('', command);
  }

  return lines;
}

/**
 * Render the `sass-migrator` invocation that resolves most of the debt.
 *
 * The migrator runs exactly one migration per invocation, so a combined command
 * would not work. The dominant migration is shown in full and any others are
 * named after it, which keeps the block to one line while staying accurate
 * about what has to be run.
 *
 * @param {Array<{id: string, occurrences: number}>} deprecations - ID-keyed buckets, most frequent first.
 * @param {string} sourceGlob - Glob matching the project stylesheets.
 * @param {(format: string|string[], text: string) => string} styler - Styling function.
 * @returns {string|undefined} Command line, when a migrator applies.
 * @see https://sass-lang.com/documentation/cli/migrator/
 */
function renderMigratorCommand(deprecations, sourceGlob, styler) {
  const migrators = [];
  for (const bucket of deprecations) {
    const migrator = deprecationMigrator(bucket.id);
    if (migrator && !migrators.includes(migrator)) migrators.push(migrator);
  }

  if (migrators.length === 0) return undefined;

  const [primary, ...rest] = migrators;
  const command = `npx sass-migrator ${primary} '${sourceGlob}'`;
  const others = rest.length > 0 ? `  (then: ${rest.join(', ')})` : '';

  return `${DETAIL_INDENT}${styler('gray', command + others)}`;
}

/**
 * Render the unresolved CSS asset block.
 *
 * Vite prints one of these per `url()` it cannot resolve, mid-build and in
 * whatever order the transforms finish. Collapsing them into one block also
 * lets the reporter say what the notice actually means: the path is emitted
 * into the CSS untouched, so it is only correct if it resolves from the output
 * directory in the browser.
 *
 * @param {Array<{url: string, importer: string|undefined, count: number}>} assets - Unresolved assets.
 * @param {string} projectDir - Project root.
 * @param {(format: string|string[], text: string) => string} styler - Styling function.
 * @returns {string[]} Unresolved asset lines.
 */
function renderUnresolvedAssets(assets, projectDir, styler) {
  if (assets.length === 0) return [];

  const lines = [
    `${INDENT}${styler('yellow', SYMBOLS.warning)} ${styler(
      'yellow',
      `${pluralize(assets.length, 'unresolved css url')}${SEPARATOR}emitted unchanged`,
    )}`,
  ];

  for (const asset of assets.slice(0, MAX_ASSET_ROWS)) {
    const from = asset.importer
      ? styler('gray', `  in ${displayPath(asset.importer, projectDir)}`)
      : '';
    lines.push(`${DETAIL_INDENT}${asset.url}${from}`);
  }

  const hidden = assets.length - MAX_ASSET_ROWS;
  if (hidden > 0) {
    lines.push(
      `${DETAIL_INDENT}${styler('gray', `+${pluralize(hidden, 'more')}`)}`,
    );
  }

  lines.push(
    `${DETAIL_INDENT}${styler(
      'gray',
      'these must resolve from the built css, not the source file',
    )}`,
  );

  return lines;
}

/**
 * Render the problem blocks shared by first builds and rebuilds.
 *
 * @param {object} snapshot - Diagnostics snapshot.
 * @param {string} projectDir - Project root.
 * @param {(format: string|string[], text: string) => string} styler - Styling function.
 * @param {string} sourceGlob - Glob matching the project stylesheets.
 * @returns {string[]} Problem lines.
 */
function renderProblems(snapshot, projectDir, styler, sourceGlob) {
  const lines = [];

  if (snapshot.errors.length > 0) {
    lines.push('');
    lines.push(
      `${INDENT}${styler('red', SYMBOLS.error)} ${styler('red', pluralize(snapshot.errors.length, 'error'))}`,
    );
    lines.push(...renderDetailRows(snapshot.errors, projectDir, styler));
  }

  if (snapshot.warnings.length > 0) {
    lines.push('');
    lines.push(
      `${INDENT}${styler('yellow', SYMBOLS.warning)} ${styler('yellow', pluralize(snapshot.warnings.length, 'warning'))}`,
    );
    lines.push(...renderDetailRows(snapshot.warnings, projectDir, styler));
  }

  const assetLines = renderUnresolvedAssets(
    snapshot.unresolvedAssets || [],
    projectDir,
    styler,
  );
  if (assetLines.length > 0) {
    lines.push('');
    lines.push(...assetLines);
  }

  const deprecationLines = renderDeprecations(
    snapshot,
    projectDir,
    styler,
    sourceGlob,
  );
  if (deprecationLines.length > 0) {
    lines.push('');
    lines.push(...deprecationLines);
  }

  return lines;
}

/**
 * Render the summary printed after the first successful watch build.
 *
 * @param {{
 *   snapshot: object,
 *   durationMs: number,
 *   outDir?: string,
 *   projectDir?: string,
 *   sourceGlob?: string,
 *   styler: (format: string|string[], text: string) => string
 * }} options - Summary inputs.
 * @returns {string[]} Summary lines.
 */
export function renderSummary({
  snapshot,
  durationMs,
  outDir = 'dist',
  projectDir = '',
  sourceGlob = 'src/**/*.scss',
  styler,
}) {
  const failed = snapshot.errors.length > 0;
  const symbol = failed
    ? styler('red', SYMBOLS.error)
    : styler('green', SYMBOLS.ok);
  const headline = failed
    ? `build failed after ${formatDuration(durationMs)}`
    : `built in ${formatDuration(durationMs)}`;

  const lines = [
    `${INDENT}${symbol} ${headline}${styler('gray', `${SEPARATOR}watching ${outDir}`)}`,
    ...renderProblems(snapshot, projectDir, styler, sourceGlob),
    '',
  ];

  return lines;
}

/**
 * Render the compact line printed after each watch rebuild.
 *
 * @param {{
 *   snapshot: object,
 *   durationMs: number,
 *   changedFiles?: string[],
 *   projectDir?: string,
 *   styler: (format: string|string[], text: string) => string,
 *   now?: Date
 * }} options - Rebuild inputs.
 * @returns {string[]} Rebuild lines.
 */
export function renderRebuild({
  snapshot,
  durationMs,
  changedFiles = [],
  projectDir = '',
  styler,
  now = new Date(),
}) {
  const failed = snapshot.errors.length > 0;
  const [firstChange] = changedFiles;
  const changeLabel =
    changedFiles.length > 1
      ? `${displayLocation(firstChange, undefined, projectDir)} +${changedFiles.length - 1}`
      : firstChange
        ? displayLocation(firstChange, undefined, projectDir)
        : 'sources';

  const outcome = failed
    ? styler('red', `rebuild failed after ${formatDuration(durationMs)}`)
    : styler('gray', `rebuilt in ${formatDuration(durationMs)}`);

  const symbol = failed
    ? styler('red', SYMBOLS.error)
    : styler('gray', SYMBOLS.change);

  const lines = [
    `${INDENT}${styler('gray', formatClockTime(now))} ${symbol} ${changeLabel}${styler('gray', SEPARATOR)}${outcome}`,
  ];

  // Repeating the deprecation tally on every keystroke would recreate the noise
  // this reporter exists to remove, so rebuilds only surface hard failures.
  if (failed) {
    lines.push(...renderDetailRows(snapshot.errors, projectDir, styler));
  }

  return lines;
}
