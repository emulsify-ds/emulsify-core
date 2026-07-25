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
  formatClockTime,
  formatDuration,
  platformLabel,
  pluralize,
} from './format.js';
import { MIGRATION_HINTS } from './sass-logger.js';

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
 * Maximum number of deprecation IDs named on the breakdown line.
 *
 * @type {number}
 */
const MAX_DEPRECATION_IDS = 4;

/**
 * Render the one-line header shown when the watcher starts.
 *
 * @param {{
 *   version?: string,
 *   platform?: string,
 *   entryCount?: number,
 *   styler: (format: string|string[], text: string) => string
 * }} options - Banner inputs.
 * @returns {string[]} Banner lines.
 */
export function renderBanner({ version, platform, entryCount, styler }) {
  const parts = [
    styler('cyan', 'emulsify'),
    styler('gray', `core ${version || '0.0.0'}`),
    styler('gray', `Platform: ${platformLabel(platform)}`),
  ];

  if (Number.isFinite(entryCount)) {
    parts.push(styler('gray', pluralize(entryCount, 'entry', 'entries')));
  }

  return ['', `${INDENT}${parts.join(styler('gray', SEPARATOR))}`, ''];
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
    const location = displayLocation(entry.file, entry.line, projectDir);
    const repeat = entry.count > 1 ? styler('gray', ` (×${entry.count})`) : '';
    lines.push(`${DETAIL_INDENT}${styler('gray', location)}${repeat}`);

    if (entry.message) {
      lines.push(`${DETAIL_INDENT}${entry.message}`);
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
 * This is the block that replaces several hundred lines of repeated Dart Sass
 * output. It reports scale first, then which deprecation classes are involved,
 * then where the worst offender lives, then how to fix it.
 *
 * @param {object} snapshot - Diagnostics snapshot.
 * @param {string} projectDir - Project root.
 * @param {(format: string|string[], text: string) => string} styler - Styling function.
 * @returns {string[]} Deprecation summary lines.
 */
function renderDeprecations(snapshot, projectDir, styler) {
  const { deprecations, deprecationTotal, deprecationFileCount } = snapshot;
  if (deprecations.length === 0) return [];

  const headline = [
    `${pluralize(deprecationTotal, 'sass deprecation')}`,
    `${pluralize(deprecations.length, 'kind')} in ${pluralize(deprecationFileCount, 'file')}`,
  ].join(SEPARATOR);

  const lines = [
    `${INDENT}${styler('yellow', SYMBOLS.warning)} ${styler('yellow', headline)}`,
  ];

  const breakdown = deprecations
    .slice(0, MAX_DEPRECATION_IDS)
    .map((bucket) => `${bucket.id} ${bucket.occurrences}`)
    .join(SEPARATOR);
  const remainingKinds = deprecations.length - MAX_DEPRECATION_IDS;
  const breakdownSuffix =
    remainingKinds > 0 ? `${SEPARATOR}+${remainingKinds} more` : '';
  lines.push(`${DETAIL_INDENT}${styler('gray', breakdown + breakdownSuffix)}`);

  const [worst] = deprecations;
  const [worstLocation] = worst.locations;
  if (worstLocation?.file) {
    const location = displayLocation(
      worstLocation.file,
      worstLocation.line,
      projectDir,
    );
    lines.push(
      `${DETAIL_INDENT}${styler('gray', `${location} (×${worstLocation.count})`)}`,
    );
  }

  const hint = MIGRATION_HINTS[worst.id];
  if (hint) {
    lines.push(`${DETAIL_INDENT}${styler('gray', hint)}`);
  }

  return lines;
}

/**
 * Render the problem blocks shared by first builds and rebuilds.
 *
 * @param {object} snapshot - Diagnostics snapshot.
 * @param {string} projectDir - Project root.
 * @param {(format: string|string[], text: string) => string} styler - Styling function.
 * @returns {string[]} Problem lines.
 */
function renderProblems(snapshot, projectDir, styler) {
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

  const deprecationLines = renderDeprecations(snapshot, projectDir, styler);
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
 *   styler: (format: string|string[], text: string) => string
 * }} options - Summary inputs.
 * @returns {string[]} Summary lines.
 */
export function renderSummary({
  snapshot,
  durationMs,
  outDir = 'dist',
  projectDir = '',
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
    ...renderProblems(snapshot, projectDir, styler),
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
