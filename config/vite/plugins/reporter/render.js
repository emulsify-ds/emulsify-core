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
  formatBytes,
  formatClockTime,
  formatDuration,
  formatPreciseBytes,
  platformLabel,
  pluralize,
} from './format.js';
import { deprecationFix, deprecationMigrator } from './sass-logger.js';
import { sharedRootPath } from './source-roots.js';

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
 * The banner carries only the version. It is emitted from `configResolved`,
 * before the build has run, so it cannot know what was written to `dist/` — and
 * splitting the project facts across two moments would mean reading the input
 * roots in one place and the output tally in another. They belong together, so
 * both live in the facts block that {@link renderFacts} prints with the summary.
 *
 * @param {{
 *   version?: string,
 *   unicode?: boolean,
 *   styler: (format: string|string[], text: string) => string
 * }} options - Banner inputs.
 * @returns {string[]} Banner lines.
 */
export function renderBanner({ version, unicode = true, styler }) {
  const mark = unicode
    ? WORDMARK.map((row) => `${INDENT}${styler(['bold', 'cyan'], row)}`)
    : [`${INDENT}${styler(['bold', 'cyan'], 'EMULSIFY')}`];

  return [
    '',
    ...mark,
    `${INDENT}${styler('gray', `core ${version || '0.0.0'}`)}`,
    '',
  ];
}

/**
 * Labels for the rows in the facts block.
 *
 * @type {{platform: string, input: string, output: string}}
 */
const FACT_LABELS = {
  platform: 'platform',
  input: 'input',
  output: 'output',
};

/**
 * Render the project facts block.
 *
 * The `input` rows are the reason this block exists. A total entry count cannot
 * distinguish a healthy project from one whose second source root was never
 * discovered, so each root is named with what it contributed. A configured root
 * reporting zero is reported rather than hidden — that row is usually the bug.
 *
 * @param {{
 *   platform?: string,
 *   inputRows?: Array<{name: string, path: string, count: number}>,
 *   outDir?: string,
 *   write?: {fileCount: number, totalBytes: number, largest?: {fileName: string, bytes: number}},
 *   styler: (format: string|string[], text: string) => string
 * }} options - Facts inputs.
 * @returns {string[]} Facts lines.
 */
export function renderFacts({
  platform,
  inputRows = [],
  outDir = 'dist',
  write,
  styler,
}) {
  const labelWidth = Math.max(
    ...Object.values(FACT_LABELS).map((label) => label.length),
  );

  /**
   * Render one labelled row, or a continuation row when the label repeats.
   *
   * @param {string|undefined} label - Row label, omitted for continuations.
   * @param {string} value - Rendered value.
   * @returns {string} Finished line.
   */
  const row = (label, value) =>
    `${DETAIL_INDENT}${styler('gray', (label || '').padEnd(labelWidth))}    ${value}`;

  const lines = [row(FACT_LABELS.platform, platformLabel(platform))];

  // Paths are padded to a shared width and counts are right-aligned on their
  // digits, so both the paths and the numbers read as columns however many roots
  // a project declares. Padding is applied before styling because ANSI escapes
  // carry no display width and would skew every row by a different amount.
  if (inputRows.length > 0) {
    const pathWidth = Math.max(...inputRows.map((entry) => entry.path.length));
    const countWidth = Math.max(
      ...inputRows.map((entry) => String(entry.count).length),
    );

    inputRows.forEach((entry, index) => {
      // An overflow row names a count of directories rather than a directory, so
      // it is dimmed to keep it from reading as a path.
      const path = styler(
        entry.overflow ? 'gray' : 'cyan',
        entry.path.padEnd(pathWidth),
      );
      const noun = entry.count === 1 ? 'entry' : 'entries';
      const count = styler(
        // A configured root that matched nothing is the row most likely to be a
        // misconfiguration, so it is the one row here that is not dim.
        entry.count === 0 ? 'yellow' : 'gray',
        `${String(entry.count).padStart(countWidth)} ${noun}`,
      );

      lines.push(
        row(index === 0 ? FACT_LABELS.input : '', `${path}  ${count}`),
      );
    });
  }

  const outputFacts = [];
  if (write) {
    outputFacts.push(pluralize(write.fileCount, 'file'));
    outputFacts.push(formatBytes(write.totalBytes));

    if (write.largest) {
      outputFacts.push(
        `largest ${write.largest.fileName} ${formatBytes(write.largest.bytes)}`,
      );
    }
  }

  const outputSuffix =
    outputFacts.length > 0
      ? styler('gray', `  ${outputFacts.join(SEPARATOR)}`)
      : '';

  lines.push(row(FACT_LABELS.output, `${outDir}${outputSuffix}`));

  return lines;
}

/**
 * Labels for the URL rows printed beneath a ready headline.
 *
 * @type {{local: string, network: string}}
 */
const URL_LABELS = {
  local: 'local',
  network: 'network',
};

/**
 * Render the ready state for a long-running service.
 *
 * Storybook announces itself with a boxed banner drawn in its own visual
 * language, which reads as a second tool's output rather than part of the
 * build. This renders the same facts in the reporter's vocabulary so one
 * `develop` run looks like one tool.
 *
 * Kept pure and service-agnostic so both callers share it: the Storybook
 * preset that runs while `concurrently` owns the terminal, and any launcher
 * that owns both child processes and prints a combined block.
 *
 * A port that does not match the one requested is reported rather than
 * silently accepted. Storybook falls forward to the next free port, so the
 * difference usually means a previous session is still running — and a browser
 * pointed at the requested port would then be showing a stale instance.
 *
 * @param {{
 *   service?: string,
 *   urls?: {local?: string, network?: string},
 *   durationMs?: number,
 *   portDrift?: {requested: number|string, actual: number|string},
 *   styler: (format: string|string[], text: string) => string
 * }} options - Ready-state inputs.
 * @returns {string[]} Ready lines.
 */
export function renderReady({
  service = 'storybook',
  urls = {},
  durationMs,
  portDrift,
  unicode = true,
  styler,
}) {
  const drifted =
    portDrift && String(portDrift.requested) !== String(portDrift.actual);

  const facts = [];
  if (Number.isFinite(durationMs)) facts.push(formatDuration(durationMs));
  if (drifted) {
    facts.push(`port ${portDrift.requested} in use, using ${portDrift.actual}`);
  }

  const symbol = drifted
    ? styler('yellow', SYMBOLS.warning)
    : styler('green', SYMBOLS.ok);
  const headline = drifted
    ? styler('yellow', `${service} ready`)
    : `${service} ready`;
  const suffix =
    facts.length > 0 ? styler('gray', SEPARATOR + facts.join(SEPARATOR)) : '';

  const lines = [`${INDENT}${symbol} ${headline}${suffix}`];

  const rows = Object.entries(URL_LABELS).filter(([key]) => urls[key]);
  if (rows.length === 0) return lines;

  // Padding is applied before styling so ANSI escapes never skew the columns.
  const labelWidth = Math.max(...rows.map(([, label]) => label.length));

  const body = rows.map(
    ([key, label]) =>
      `${INDENT}${INDENT}${styler('gray', label.padEnd(labelWidth))}   ${styler(['bold', 'cyan'], urls[key])}`,
  );

  // The rules are measured from the longest row rather than fixed, so a long
  // network address or an added row cannot punch through the panel. Width is
  // taken from the unstyled text because ANSI escapes carry no display width.
  const width =
    Math.max(
      ...rows.map(
        ([key, label]) =>
          INDENT.length * 2 +
          label.padEnd(labelWidth).length +
          3 +
          urls[key].length,
      ),
    ) - INDENT.length;

  lines.push('');
  lines.push(...renderPanel(body, width, drifted, unicode, styler));
  // Storybook keeps logging after it announces itself — timing lines, and under
  // `--ci` a migration notice or two. Closing with a blank line stops those from
  // butting straight up against the panel's lower rule.
  lines.push('');

  return lines;
}

/**
 * Frame a block of rows between two half-block rules.
 *
 * Storybook draws its ready state in a rounded box, which reads as a second
 * tool's output rather than as part of the build. The rules here are built from
 * the same half-block glyphs as the wordmark, so the panel belongs to Emulsify's
 * visual language instead of importing another tool's.
 *
 * The glyph choice is deliberate: `▄` sits on the baseline and `▀` sits at cap
 * height, so the pair encloses the rows without the corner joins that
 * box-drawing characters need — and without the alignment failures those joins
 * produce when a row contains a character the font renders at a different width.
 *
 * Terminals that cannot render block glyphs get the rows alone. The same
 * `supportsUnicode()` gate gives the wordmark its plain-text fallback, so a
 * terminal always gets both treatments or neither.
 *
 * @param {string[]} body - Rendered rows to enclose.
 * @param {number} width - Rule width in columns.
 * @param {boolean} warned - Whether the panel reports a problem.
 * @param {boolean} unicode - Whether block glyphs are safe to emit.
 * @param {(format: string|string[], text: string) => string} styler - Styling function.
 * @returns {string[]} Panel lines.
 */
function renderPanel(body, width, warned, unicode, styler) {
  if (!unicode) return body;

  const color = warned ? 'yellow' : 'cyan';
  const safeWidth = Math.max(1, Math.round(width));

  return [
    `${INDENT}${styler(color, '▄'.repeat(safeWidth))}`,
    ...body,
    `${INDENT}${styler(color, '▀'.repeat(safeWidth))}`,
  ];
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
  unicode = true,
) {
  const attention = [];

  const syntaxLines = renderSyntaxErrors(syntaxErrors, styler);
  if (syntaxLines.length > 0) {
    attention.push('');
    attention.push(...syntaxLines);
  }

  const importLines = renderImportErrors(
    importErrors.rows || [],
    importErrors.sharedDirectory,
    Boolean(importErrors.directoryExists),
    styler,
  );
  if (importLines.length > 0) {
    attention.push('');
    attention.push(...importLines);
  }

  if (snapshot.errors.length > 0) {
    attention.push('');
    attention.push(
      `${INDENT}${styler('red', SYMBOLS.error)} ${styler('red', pluralize(snapshot.errors.length, 'error'))}`,
    );
    attention.push(...renderDetailRows(snapshot.errors, projectDir, styler));
  }

  if (snapshot.warnings.length > 0) {
    attention.push('');
    attention.push(
      `${INDENT}${styler('yellow', SYMBOLS.warning)} ${styler('yellow', pluralize(snapshot.warnings.length, 'warning'))}`,
    );
    attention.push(...renderDetailRows(snapshot.warnings, projectDir, styler));
  }

  const assetLines = renderUnresolvedAssets(assetRows, styler);
  if (assetLines.length > 0) {
    attention.push('');
    attention.push(...assetLines);
  }

  const debt = renderDeprecations(snapshot, projectDir, styler, sourceGlob);

  const lines = [];

  // Sass deprecations are inherited debt on almost every project, and there are
  // usually two orders of magnitude more of them than of today's actual
  // breakages. Without the split, 190 deprecations and six broken asset URLs
  // compete for the same attention; with it, the reader knows which block is
  // about the edit they just made.
  //
  // A divider is only drawn when its section has content. Labelling an empty
  // category advertises a problem the project does not have.
  if (attention.length > 0) {
    lines.push('', renderDivider('needs attention', unicode, styler));
    lines.push(...attention);
  }

  if (debt.length > 0) {
    lines.push('', renderDivider('pre-existing debt', unicode, styler));
    lines.push('');
    lines.push(...debt);
  }

  return lines;
}

/**
 * Total width of a section divider, in columns.
 *
 * Chosen to sit inside an 80-column terminal alongside the two-space indent.
 *
 * @type {number}
 */
const DIVIDER_WIDTH = 54;

/**
 * Render a labelled section divider.
 *
 * Falls back to ASCII dashes where box-drawing characters would not render, on
 * the same gate as the wordmark and the ready panel.
 *
 * @param {string} label - Section label.
 * @param {boolean} unicode - Whether box-drawing characters are safe to emit.
 * @param {(format: string|string[], text: string) => string} styler - Styling function.
 * @returns {string} Divider line.
 */
function renderDivider(label, unicode, styler) {
  const rule = unicode ? '─' : '-';
  const prefix = `${rule.repeat(2)} ${label} `;
  const fill = Math.max(3, DIVIDER_WIDTH - prefix.length);

  return `${INDENT}${styler('gray', `${prefix}${rule.repeat(fill)}`)}`;
}

/**
 * Column headings for the verbose input listing.
 *
 * @type {{source: string, size: string}}
 */
const INPUT_FILE_HEADINGS = { source: 'source', size: 'size' };

/**
 * Column headings for the verbose output listing.
 *
 * @type {{file: string, size: string, gzip: string}}
 */
const OUTPUT_FILE_HEADINGS = { file: 'file', size: 'size', gzip: 'gzip' };

/**
 * Placeholder for a size that does not apply or could not be read.
 *
 * @type {string}
 */
const NO_SIZE = '—';

/**
 * Render a right-aligned size column.
 *
 * Padding is applied to the unstyled text because ANSI escapes carry no display
 * width and would skew every row by a different amount.
 *
 * @param {number|undefined} bytes - Size in bytes.
 * @param {number} width - Column width.
 * @param {(format: string|string[], text: string) => string} styler - Styling function.
 * @returns {string} Padded, styled size.
 */
const sizeColumn = (bytes, width, styler) =>
  styler(
    'gray',
    (Number.isFinite(bytes) ? formatPreciseBytes(bytes) : NO_SIZE).padStart(
      width,
    ),
  );

/**
 * Measure the widest rendered size in a set of rows.
 *
 * @param {Array<number|undefined>} values - Byte values.
 * @param {string} heading - Column heading, which also has to fit.
 * @returns {number} Column width.
 */
const sizeWidth = (values, heading) =>
  Math.max(
    heading.length,
    ...values.map(
      (bytes) =>
        (Number.isFinite(bytes) ? formatPreciseBytes(bytes) : NO_SIZE).length,
    ),
  );

/**
 * Render the verbose listing of every entry the build reads.
 *
 * @param {Array<{path: string, bytes?: number}>} rows - Input file rows.
 * @param {boolean} unicode - Whether box-drawing characters are safe to emit.
 * @param {(format: string|string[], text: string) => string} styler - Styling function.
 * @returns {string[]} Input listing lines.
 */
function renderInputFiles(rows, unicode, styler) {
  if (rows.length === 0) return [];

  const pathWidth = Math.max(
    INPUT_FILE_HEADINGS.source.length,
    ...rows.map((row) => row.path.length),
  );
  const width = sizeWidth(
    rows.map((row) => row.bytes),
    INPUT_FILE_HEADINGS.size,
  );

  const lines = [
    '',
    renderDivider('input files', unicode, styler),
    '',
    `${DETAIL_INDENT}${styler(
      'gray',
      `${INPUT_FILE_HEADINGS.source.padEnd(pathWidth)}  ${INPUT_FILE_HEADINGS.size.padStart(width)}`,
    )}`,
  ];

  for (const row of rows) {
    lines.push(
      `${DETAIL_INDENT}${styler('cyan', row.path.padEnd(pathWidth))}  ${sizeColumn(row.bytes, width, styler)}`,
    );
  }

  return lines;
}

/**
 * Render the verbose listing of every file the build wrote.
 *
 * @param {Array<{fileName: string, bytes: number, gzipBytes?: number}>} rows - Output file rows.
 * @param {boolean} unicode - Whether box-drawing characters are safe to emit.
 * @param {(format: string|string[], text: string) => string} styler - Styling function.
 * @returns {string[]} Output listing lines.
 */
function renderOutputFiles(rows, unicode, styler) {
  if (rows.length === 0) return [];

  const lines = [
    '',
    renderDivider('output files', unicode, styler),
    '',
    ...renderSizeTable(rows, styler),
  ];

  return lines;
}

/**
 * Render a file-and-size table, with a gzip column when any row has one.
 *
 * Shared by the first build's output listing and the rebuild's changed-file
 * listing so the two read identically — the second is a filtered view of the
 * first, and formatting them differently would obscure that.
 *
 * @param {Array<{fileName: string, bytes: number, gzipBytes?: number}>} rows - Output file rows.
 * @param {(format: string|string[], text: string) => string} styler - Styling function.
 * @returns {string[]} Table lines.
 */
function renderSizeTable(rows, styler) {
  const nameWidth = Math.max(
    OUTPUT_FILE_HEADINGS.file.length,
    ...rows.map((row) => row.fileName.length),
  );
  const width = sizeWidth(
    rows.map((row) => row.bytes),
    OUTPUT_FILE_HEADINGS.size,
  );

  // The gzip column is dropped entirely when nothing in the table is
  // compressible, rather than printed as a column of dashes.
  const compressed = rows.some((row) => Number.isFinite(row.gzipBytes));
  const gzipHeading = compressed
    ? `  ${OUTPUT_FILE_HEADINGS.gzip.padStart(
        sizeWidth(
          rows.map((row) => row.gzipBytes),
          OUTPUT_FILE_HEADINGS.gzip,
        ),
      )}`
    : '';
  const gzipWidth = compressed
    ? sizeWidth(
        rows.map((row) => row.gzipBytes),
        OUTPUT_FILE_HEADINGS.gzip,
      )
    : 0;

  const lines = [
    `${DETAIL_INDENT}${styler(
      'gray',
      `${OUTPUT_FILE_HEADINGS.file.padEnd(nameWidth)}  ${OUTPUT_FILE_HEADINGS.size.padStart(width)}${gzipHeading}`,
    )}`,
  ];

  for (const row of rows) {
    const gzip = compressed
      ? `  ${sizeColumn(row.gzipBytes, gzipWidth, styler)}`
      : '';

    lines.push(
      `${DETAIL_INDENT}${styler('cyan', row.fileName.padEnd(nameWidth))}  ${sizeColumn(row.bytes, width, styler)}${gzip}`,
    );
  }

  return lines;
}

/**
 * Render the standalone CSS asset block a one-shot build prints.
 *
 * One-shot builds are silent unless something is wrong, so this is deliberately
 * the whole report rather than a section of one: no banner, no project facts,
 * no deprecation tally. A clean project keeps its output byte for byte.
 *
 * @param {{assetRows?: Array<object>, rebases?: Array<object>, styler: Function}} options - Render inputs.
 * @returns {string[]} Report lines.
 */
export function renderAssetSummary({ assetRows = [], rebases = [], styler }) {
  const repaired = rebases.filter((entry) => entry.status === 'rebased');
  const ambiguous = rebases.filter((entry) => entry.status === 'ambiguous');

  if (!assetRows.length && !repaired.length && !ambiguous.length) return [];

  const lines = [''];

  if (repaired.length) {
    lines.push(
      `${INDENT}${styler(
        'gray',
        `${pluralize(repaired.length, 'css asset url')} rebased to /assets/`,
      )}`,
      '',
    );

    for (const entry of repaired.slice(0, MAX_ASSET_ROWS)) {
      lines.push(
        `${DETAIL_INDENT}${styler('gray', `${entry.url} -> ${entry.rewritten}`)}`,
      );
    }

    const hidden = repaired.length - MAX_ASSET_ROWS;
    if (hidden > 0) {
      lines.push(
        `${DETAIL_INDENT}${styler('gray', `+${pluralize(hidden, 'more')}`)}`,
      );
    }

    lines.push(
      '',
      `${DETAIL_INDENT}${styler(
        'gray',
        'run `emulsify-audit --fix` to write these canonically in source',
      )}`,
    );
  }

  for (const entry of ambiguous) {
    lines.push(
      `${INDENT}${styler('yellow', SYMBOLS.warning)} ${styler(
        'yellow',
        `${entry.url} matches more than one asset root`,
      )}`,
    );
  }

  lines.push(...renderUnresolvedAssets(assetRows, styler));

  return lines;
}

/**
 * Render the summary printed after the first successful watch build.
 *
 * Emitted as four labelled sections — project, build, and whichever problem
 * headings have content. `watchLabel` is supplied by the plugin, which has the
 * resolved source roots; without it the label is inferred from the input rows.
 *
 * @param {{
 *   snapshot: object,
 *   durationMs: number,
 *   outDir?: string,
 *   projectDir?: string,
 *   sourceGlob?: string,
 *   assetRows?: Array<object>,
 *   importErrors?: {rows?: Array<object>, sharedDirectory?: string, directoryExists?: boolean},
 *   platform?: string,
 *   inputRows?: Array<{name: string, path: string, count: number, overflow?: boolean}>,
 *   watchLabel?: string,
 *   write?: {fileCount: number, totalBytes: number, largest?: {fileName: string, bytes: number}},
 *   inputFiles?: Array<{path: string, bytes?: number}>,
 *   outputFiles?: Array<{fileName: string, bytes: number, gzipBytes?: number}>,
 *   unicode?: boolean,
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
  platform,
  inputRows = [],
  watchLabel,
  write,
  inputFiles = [],
  outputFiles = [],
  unicode = true,
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

  // `dist/` is written, not watched. Falling back to the input rows keeps the
  // label honest for any caller that renders a summary without the resolved
  // source roots to hand.
  const watching =
    watchLabel ||
    sharedRootPath(
      inputRows.filter((entry) => !entry.overflow).map((entry) => entry.path),
    ) ||
    'sources';

  // The two halves are labelled with the same dividers the problem blocks use, so
  // the whole summary reads as one sequence of named sections rather than a wall
  // of rows followed by some headings. The labels also give the facts block
  // somewhere to end: without one, `output` ran straight into the build result.
  //
  // Storybook's startup lines land between the banner and this block, so it opens
  // with a blank line rather than trusting whatever printed last to have left one.
  return [
    '',
    renderDivider('project', unicode, styler),
    '',
    ...renderFacts({ platform, inputRows, outDir, write, styler }),
    // The verbose listings expand the two rows above them, so they sit directly
    // under the totals they itemize rather than after the build result.
    ...renderInputFiles(inputFiles, unicode, styler),
    ...renderOutputFiles(outputFiles, unicode, styler),
    '',
    renderDivider('build', unicode, styler),
    '',
    `${INDENT}${symbol} ${headline}${styler('gray', `${SEPARATOR}watching ${watching}`)}`,
    ...renderProblems(
      snapshot,
      projectDir,
      styler,
      sourceGlob,
      assetRows,
      importErrors,
      syntaxErrors,
      unicode,
    ),
    '',
  ];
}

/**
 * Render the compact line printed after each watch rebuild.
 *
 * In detailed mode the line is followed by what the rebuild actually produced:
 * how many modules were transformed, and which outputs came out different. That
 * is a deliberate departure from Rolldown's table, which reprints all seventy-odd
 * files every cycle because Rollup regenerates the whole bundle every cycle. The
 * question after an edit is which files changed, and the negative answer — an
 * edit that compiled to byte-identical output — is worth a line of its own.
 *
 * @param {{
 *   snapshot: object,
 *   durationMs: number,
 *   changedFiles?: string[],
 *   projectDir?: string,
 *   moduleCount?: number,
 *   changedOutputs?: Array<{fileName: string, bytes: number, gzipBytes?: number}>,
 *   removedOutputs?: string[],
 *   detailed?: boolean,
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
  moduleCount,
  changedOutputs = [],
  removedOutputs = [],
  detailed = false,
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
    return lines;
  }

  if (detailed)
    lines.push(
      ...renderRebuildDetail(
        { moduleCount, changedOutputs, removedOutputs },
        styler,
      ),
    );

  return lines;
}

/**
 * Render the detailed tail of a successful rebuild.
 *
 * @param {{
 *   moduleCount?: number,
 *   changedOutputs?: Array<{fileName: string, bytes: number, gzipBytes?: number}>,
 *   removedOutputs?: string[]
 * }} cycle - What the rebuild produced.
 * @param {(format: string|string[], text: string) => string} styler - Styling function.
 * @returns {string[]} Detail lines.
 */
function renderRebuildDetail(
  { moduleCount, changedOutputs = [], removedOutputs = [] },
  styler,
) {
  const facts = [];
  if (Number.isFinite(moduleCount)) {
    facts.push(`${pluralize(moduleCount, 'module')} transformed`);
  }

  facts.push(
    changedOutputs.length === 0
      ? 'no output changed'
      : `${pluralize(changedOutputs.length, 'output')} changed`,
  );

  if (removedOutputs.length > 0) {
    facts.push(`${pluralize(removedOutputs.length, 'output')} removed`);
  }

  const lines = [
    '',
    `${DETAIL_INDENT}${styler('gray', facts.join(SEPARATOR))}`,
  ];

  if (changedOutputs.length > 0) {
    lines.push('', ...renderSizeTable(changedOutputs, styler));
  }

  // Removals carry no size, so they cannot share the table without a column of
  // dashes. They get their own labelled group instead.
  if (removedOutputs.length > 0) {
    lines.push('', `${DETAIL_INDENT}${styler('gray', 'no longer written')}`);

    for (const fileName of removedOutputs) {
      lines.push(`${DETAIL_INDENT}${styler('cyan', fileName)}`);
    }
  }

  return lines;
}
