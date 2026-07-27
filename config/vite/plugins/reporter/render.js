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
const ROW_INDENT = '        ';
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
    DEPRECATION_HEADINGS.lines.length,
    ...rows.map((e) => formatLineList(e.lines).length),
  );
  const countWidth = Math.max(
    DEPRECATION_HEADINGS.count.length,
    ...rows.map((e) => `${e.count}×`.length),
  );
  const idWidth = Math.max(
    DEPRECATION_HEADINGS.id.length,
    ...rows.map((e) => e.id.length),
  );

  lines.push(
    `${ROW_INDENT}${styler(
      'gray',
      `${DEPRECATION_HEADINGS.lines.padEnd(lineWidth)}  ${DEPRECATION_HEADINGS.count.padStart(countWidth)}  ${DEPRECATION_HEADINGS.id.padEnd(idWidth)}  ${DEPRECATION_HEADINGS.fix}`,
    )}`,
  );

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
        `${ROW_INDENT}${styler('gray', lineRef)}  ${styler('yellow', count)}  ${styler('gray', id)}  ${fix}`.trimEnd(),
      );
    }

    const hiddenKinds = group.entries.length - MAX_DEPRECATION_KINDS_PER_FILE;
    if (hiddenKinds > 0) {
      lines.push(
        `${ROW_INDENT}${styler('gray', `+${pluralize(hiddenKinds, 'more kind')}`)}`,
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
 * Column headings for the unresolved asset table.
 *
 * `on disk` has to label both a directory and a not-found state, which is why
 * it is not called something like "found in".
 *
 * @type {{where: string, url: string, disk: string}}
 */
const ASSET_HEADINGS = {
  where: 'referenced in',
  url: 'url',
  disk: 'on disk',
};

/**
 * Column headings for the deprecation worklist.
 *
 * These sit at the row indent rather than the file indent so each label lands
 * directly above the column it names.
 *
 * @type {{lines: string, count: string, id: string, fix: string}}
 */
const DEPRECATION_HEADINGS = {
  lines: 'lines',
  count: 'count',
  id: 'deprecation',
  fix: 'fix',
};

/**
 * Colors for each on-disk resolution state.
 *
 * @type {Record<string, string>}
 */
const ASSET_STATUS_COLORS = {
  found: 'green',
  missing: 'red',
  ambiguous: 'yellow',
  unknown: 'gray',
};

/**
 * Column headings for the missing-import table.
 *
 * @type {{where: string, specifier: string, disk: string}}
 */
const IMPORT_HEADINGS = {
  where: 'imported by',
  specifier: 'import',
  disk: 'on disk',
};

/**
 * Maximum likely-source leads listed for one syntax error.
 *
 * @type {number}
 */
const MAX_SOURCE_LEADS = 4;

/**
 * Render the CSS syntax error block.
 *
 * The minifier runs on the concatenated bundle, so its line number refers to
 * generated CSS and names no file. The offending declaration is shown verbatim
 * with the minifier's caret, followed by wherever that declaration's literals
 * appear in the project. Those are labelled likely, not definite, because they
 * come from a search rather than a source map.
 *
 * @param {Array<{
 *   minifier: string,
 *   message: string,
 *   bundleLine?: number,
 *   declaration?: string,
 *   caretColumn?: number,
 *   lead?: {token: string, matches: Array<{file: string, line: number}>}
 * }>} errors - Parsed syntax errors.
 * @param {(format: string|string[], text: string) => string} styler - Styling function.
 * @returns {string[]} Syntax error lines.
 */
function renderSyntaxErrors(errors, styler) {
  if (errors.length === 0) return [];

  const lines = [
    `${INDENT}${styler('red', SYMBOLS.error)} ${styler('red', pluralize(errors.length, 'css syntax error'))}`,
    '',
  ];

  for (const error of errors) {
    lines.push(
      `${DETAIL_INDENT}${styler('gray', error.minifier)}  ${error.message}`,
    );

    if (error.declaration) {
      lines.push(`${DETAIL_INDENT}${error.declaration}`);

      if (error.caretColumn != null) {
        lines.push(
          `${DETAIL_INDENT}${' '.repeat(error.caretColumn)}${styler('red', '^')}`,
        );
      }
    }

    const matches = error.lead?.matches || [];
    if (matches.length > 0) {
      lines.push('', `${DETAIL_INDENT}${styler('gray', 'likely source')}`);

      const width = Math.max(
        ...matches
          .slice(0, MAX_SOURCE_LEADS)
          .map((match) => `${match.file}:${match.line}`.length),
      );

      for (const match of matches.slice(0, MAX_SOURCE_LEADS)) {
        const location = `${match.file}:${match.line}`.padEnd(width);
        lines.push(
          `${DETAIL_INDENT}${styler('cyan', location)}  ${styler('gray', error.lead.token)}`,
        );
      }

      const hidden = matches.length - MAX_SOURCE_LEADS;
      if (hidden > 0) {
        lines.push(
          `${DETAIL_INDENT}${styler('gray', `+${pluralize(hidden, 'more')}`)}`,
        );
      }
    }

    if (error.bundleLine != null) {
      // Named as generated output so it never reads as a source location.
      lines.push(
        '',
        `${DETAIL_INDENT}${styler('gray', `bundle line ${error.bundleLine} · EMULSIFY_VERBOSE=1 for full output`)}`,
      );
    }
  }

  return lines;
}

/**
 * Render the missing Sass import block.
 *
 * Replaces Rolldown's aggregate dump, which prints every error three times
 * with a Dart Sass stack trace attached. The table keeps one row per importing
 * site and closes with the directory they all point into, because a deleted
 * partial usually breaks several components at once.
 *
 * @param {Array<{where: string, specifier: string, status: string, label: string}>} rows - Import rows.
 * @param {string|undefined} sharedDirectory - Directory every import resolves under.
 * @param {boolean} directoryExists - Whether that directory is present.
 * @param {(format: string|string[], text: string) => string} styler - Styling function.
 * @returns {string[]} Missing import lines.
 */
function renderImportErrors(rows, sharedDirectory, directoryExists, styler) {
  if (rows.length === 0) return [];

  const shown = rows.slice(0, MAX_ASSET_ROWS);
  const distinct = new Set(rows.map((row) => row.specifier)).size;
  const headline = [
    pluralize(distinct, 'missing stylesheet'),
    pluralize(rows.length, 'import error'),
  ].join(SEPARATOR);

  const whereWidth = Math.max(
    IMPORT_HEADINGS.where.length,
    ...shown.map((row) => row.where.length),
  );
  const specifierWidth = Math.max(
    IMPORT_HEADINGS.specifier.length,
    ...shown.map((row) => row.specifier.length),
  );

  const lines = [
    `${INDENT}${styler('red', SYMBOLS.error)} ${styler('red', headline)}`,
    '',
    `${DETAIL_INDENT}${styler(
      'gray',
      `${IMPORT_HEADINGS.where.padEnd(whereWidth)}  ${IMPORT_HEADINGS.specifier.padEnd(specifierWidth)}  ${IMPORT_HEADINGS.disk}`,
    )}`,
  ];

  for (const row of shown) {
    const where = styler('cyan', row.where.padEnd(whereWidth));
    const specifier = row.specifier.padEnd(specifierWidth);
    const disk = styler(row.status === 'moved' ? 'yellow' : 'red', row.label);

    lines.push(`${DETAIL_INDENT}${where}  ${specifier}  ${disk}`.trimEnd());
  }

  const hidden = rows.length - MAX_ASSET_ROWS;
  if (hidden > 0) {
    lines.push(
      `${DETAIL_INDENT}${styler('gray', `+${pluralize(hidden, 'more')}`)}`,
    );
  }

  if (sharedDirectory) {
    const cause = directoryExists
      ? `all ${rows.length} resolve under ${sharedDirectory}`
      : `all ${rows.length} resolve under ${sharedDirectory} — directory not found`;
    lines.push('', `${DETAIL_INDENT}${styler('gray', cause)}`);
  }

  return lines;
}

/**
 * Render the unresolved CSS asset block.
 *
 * Vite prints one of these per `url()` it cannot resolve, mid-build and in
 * whatever order the transforms finish. Collapsing them into one table also
 * lets the reporter answer what the raw notice cannot: which stylesheet writes
 * the URL, and whether the file exists anywhere in the project.
 *
 * @param {Array<{where: string, url: string, status: string, label: string}>} rows - Enriched rows.
 * @param {(format: string|string[], text: string) => string} styler - Styling function.
 * @returns {string[]} Unresolved asset lines.
 */
function renderUnresolvedAssets(rows, styler) {
  if (rows.length === 0) return [];

  const shown = rows.slice(0, MAX_ASSET_ROWS);
  const found = rows.filter((row) => row.status === 'found').length;
  const missing = rows.filter((row) => row.status === 'missing').length;

  const tally = [`${found} found`, `${missing} missing`].join(', ');
  const headline = `${pluralize(rows.length, 'unresolved css url')}${SEPARATOR}${tally}`;

  // Padding is applied before styling so ANSI escapes never skew the columns.
  const whereWidth = Math.max(
    ASSET_HEADINGS.where.length,
    ...shown.map((row) => row.where.length),
  );
  const urlWidth = Math.max(
    ASSET_HEADINGS.url.length,
    ...shown.map((row) => row.url.length),
  );

  const lines = [
    `${INDENT}${styler('yellow', SYMBOLS.warning)} ${styler('yellow', headline)}`,
    '',
    `${DETAIL_INDENT}${styler(
      'gray',
      `${ASSET_HEADINGS.where.padEnd(whereWidth)}  ${ASSET_HEADINGS.url.padEnd(urlWidth)}  ${ASSET_HEADINGS.disk}`,
    )}`,
  ];

  for (const row of shown) {
    const where = styler('cyan', row.where.padEnd(whereWidth));
    const url = row.url.padEnd(urlWidth);
    const disk = styler(ASSET_STATUS_COLORS[row.status] || 'gray', row.label);

    lines.push(`${DETAIL_INDENT}${where}  ${url}  ${disk}`.trimEnd());
  }

  const hidden = rows.length - MAX_ASSET_ROWS;
  if (hidden > 0) {
    lines.push(
      `${DETAIL_INDENT}${styler('gray', `+${pluralize(hidden, 'more')}`)}`,
    );
  }

  lines.push(
    '',
    `${DETAIL_INDENT}${styler(
      'gray',
      'paths resolve from dist/, not from the scss file',
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
 * @param {Array<object>} assetRows - Enriched unresolved asset rows.
 * @returns {string[]} Problem lines.
 */
function renderProblems(
  snapshot,
  projectDir,
  styler,
  sourceGlob,
  assetRows,
  importErrors,
  syntaxErrors,
) {
  const lines = [];

  const syntaxLines = renderSyntaxErrors(syntaxErrors, styler);
  if (syntaxLines.length > 0) {
    lines.push('');
    lines.push(...syntaxLines);
  }

  const importLines = renderImportErrors(
    importErrors.rows || [],
    importErrors.sharedDirectory,
    Boolean(importErrors.directoryExists),
    styler,
  );
  if (importLines.length > 0) {
    lines.push('');
    lines.push(...importLines);
  }

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

  const assetLines = renderUnresolvedAssets(assetRows, styler);
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
 *   assetRows?: Array<object>,
 *   importErrors?: {rows?: Array<object>, sharedDirectory?: string, directoryExists?: boolean},
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
  assetRows = [],
  importErrors = {},
  syntaxErrors = [],
  styler,
}) {
  const failed =
    snapshot.errors.length > 0 ||
    (importErrors.rows || []).length > 0 ||
    syntaxErrors.length > 0;
  const symbol = failed
    ? styler('red', SYMBOLS.error)
    : styler('green', SYMBOLS.ok);
  const headline = failed
    ? `build failed after ${formatDuration(durationMs)}`
    : `built in ${formatDuration(durationMs)}`;

  const lines = [
    `${INDENT}${symbol} ${headline}${styler('gray', `${SEPARATOR}watching ${outDir}`)}`,
    ...renderProblems(
      snapshot,
      projectDir,
      styler,
      sourceGlob,
      assetRows,
      importErrors,
      syntaxErrors,
    ),
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
