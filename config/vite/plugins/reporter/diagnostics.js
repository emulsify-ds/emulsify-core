/**
 * @file Diagnostic collection for the Emulsify develop reporter.
 *
 * Vite, Sass, and Rollup each report problems on their own schedule and in
 * their own format. A single build cycle can emit the same Sass deprecation
 * dozens of times, once per entry that transitively imports the offending
 * partial, which is what makes the default `npm run develop` output unreadable.
 *
 * This module collects those reports into one per-cycle model that counts
 * repeats instead of reprinting them. Deprecations are bucketed by deprecation
 * ID, then by source location within that ID, so the reporter can say
 * "slash-div, 20 occurrences across 1 file" rather than emitting 20 stack
 * traces. Errors and plain warnings are deduplicated on the same key so a
 * failure surfaced by two channels only reads as one problem.
 */

const UNKNOWN_DEPRECATION_ID = 'unknown';

/**
 * Build the deduplication key for a single reported source location.
 *
 * @param {string|undefined} file - Source file path, when known.
 * @param {number|undefined} line - 1-based line number, when known.
 * @returns {string} Stable location key.
 */
const locationKey = (file, line) =>
  `${file || '<unknown>'}:${line == null ? '?' : line}`;

/**
 * Build the deduplication key for an error or plain warning.
 *
 * @param {{message?: string, file?: string, line?: number}} entry - Reported entry.
 * @returns {string} Stable entry key.
 */
const entryKey = (entry) =>
  `${locationKey(entry.file, entry.line)}|${entry.message || ''}`;

/**
 * Record one occurrence against a location map, incrementing when repeated.
 *
 * @param {Map<string, {file: string|undefined, line: number|undefined, count: number}>} locations - Location map.
 * @param {string|undefined} file - Source file path.
 * @param {number|undefined} line - 1-based line number.
 * @returns {void}
 */
const tallyLocation = (locations, file, line) => {
  const key = locationKey(file, line);
  const existing = locations.get(key);

  if (existing) {
    existing.count += 1;
    return;
  }

  locations.set(key, { file, line, count: 1 });
};

/**
 * Sort locations by descending occurrence count, then by path for stability.
 *
 * @param {{file: string|undefined, line: number|undefined, count: number}} a - First location.
 * @param {{file: string|undefined, line: number|undefined, count: number}} b - Second location.
 * @returns {number} Comparator result.
 */
const byCountThenPath = (a, b) =>
  b.count - a.count ||
  locationKey(a.file, a.line).localeCompare(locationKey(b.file, b.line));

/**
 * Invert the deprecation buckets into a per-file worklist.
 *
 * The collector groups by deprecation ID because that is how Sass reports, but
 * fixing the debt is a per-file activity: you open one partial and change the
 * handful of lines inside it. This projection produces that view — each file
 * with the offending lines beneath it — without disturbing the ID-keyed model
 * the totals are computed from.
 *
 * Within a file the same deprecation is collapsed into one entry carrying every
 * affected line. Ten `slash-div` hits across ten lines of one partial is one
 * edit to make, not ten findings to read.
 *
 * @param {Array<{id: string, locations: Array<{file: string|undefined, line: number|undefined, count: number}>}>} deprecationList - ID-keyed buckets.
 * @returns {Array<{file: string, occurrences: number, entries: Array<{id: string, count: number, lines: number[]}>}>} File-keyed worklist.
 */
const groupDeprecationsByFile = (deprecationList) => {
  /** @type {Map<string, {file: string, occurrences: number, entries: Map<string, object>}>} */
  const files = new Map();

  for (const bucket of deprecationList) {
    for (const location of bucket.locations) {
      // A location with no file cannot be opened, so it has no place in a
      // worklist. Those still count toward the headline totals.
      if (!location.file) continue;

      let group = files.get(location.file);
      if (!group) {
        group = { file: location.file, occurrences: 0, entries: new Map() };
        files.set(location.file, group);
      }

      let entry = group.entries.get(bucket.id);
      if (!entry) {
        entry = { id: bucket.id, count: 0, lines: [] };
        group.entries.set(bucket.id, entry);
      }

      group.occurrences += location.count;
      entry.count += location.count;
      if (location.line != null && !entry.lines.includes(location.line)) {
        entry.lines.push(location.line);
      }
    }
  }

  return [...files.values()]
    .map((group) => ({
      file: group.file,
      occurrences: group.occurrences,
      entries: [...group.entries.values()]
        .map((entry) => ({
          ...entry,
          lines: [...entry.lines].sort((a, b) => a - b),
        }))
        .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id)),
    }))
    .sort(
      (a, b) => b.occurrences - a.occurrences || a.file.localeCompare(b.file),
    );
};

/**
 * Create a per-cycle diagnostic collector.
 *
 * The collector is intentionally synchronous and process-local. The Sass logger
 * and the reporter plugin both run inside the same Vite process, so they can
 * share one instance directly without any cross-process coordination.
 *
 * @returns {{
 *   recordDeprecation: (entry: {id?: string, file?: string, line?: number}) => void,
 *   recordWarning: (entry: {message?: string, file?: string, line?: number}) => void,
 *   recordError: (entry: {message?: string, file?: string, line?: number}) => void,
 *   recordUnresolvedAsset: (entry: {url?: string, importer?: string}) => void,
 *   recordImportError: (entry: {file?: string, line?: number, specifier?: string}) => void,
 *   recordSyntaxError: (entry: {minifier?: string, message?: string, declaration?: string}) => void,
 *   hasCapturedBuildErrors: () => boolean,
 *   snapshot: () => {
 *     deprecations: Array<{id: string, occurrences: number, locations: Array<{file: string|undefined, line: number|undefined, count: number}>}>,
 *     deprecationsByFile: Array<{file: string, occurrences: number, entries: Array<{id: string, count: number, lines: number[]}>}>,
 *     unresolvedAssets: Array<{url: string, importer: string|undefined, count: number}>,
 *     importErrors: Array<{file: string|undefined, line: number|undefined, specifier: string, count: number}>,
 *     syntaxErrors: Array<{minifier: string|undefined, message: string, declaration: string|undefined, count: number}>,
 *     warnings: Array<{message: string|undefined, file: string|undefined, line: number|undefined, count: number}>,
 *     errors: Array<{message: string|undefined, file: string|undefined, line: number|undefined, count: number}>,
 *     deprecationTotal: number,
 *     deprecationFileCount: number,
 *     hasProblems: boolean
 *   },
 *   reset: () => void
 * }} Diagnostic collector.
 */
export function createDiagnosticsCollector() {
  /** @type {Map<string, {id: string, occurrences: number, locations: Map<string, object>}>} */
  let deprecations = new Map();
  /** @type {Map<string, object>} */
  let warnings = new Map();
  /** @type {Map<string, object>} */
  let errors = new Map();
  /** @type {Map<string, {url: string, importer: string|undefined, count: number}>} */
  let unresolvedAssets = new Map();
  /** @type {Map<string, object>} */
  let importErrors = new Map();
  /** @type {Map<string, object>} */
  let syntaxErrors = new Map();

  /**
   * Record one deprecation occurrence.
   *
   * @param {{id?: string, file?: string, line?: number}} entry - Deprecation details.
   * @returns {void}
   */
  const recordDeprecation = ({ id, file, line } = {}) => {
    const deprecationId = id || UNKNOWN_DEPRECATION_ID;
    let bucket = deprecations.get(deprecationId);

    if (!bucket) {
      bucket = { id: deprecationId, occurrences: 0, locations: new Map() };
      deprecations.set(deprecationId, bucket);
    }

    bucket.occurrences += 1;
    tallyLocation(bucket.locations, file, line);
  };

  /**
   * Record one entry against a deduplicating map.
   *
   * @param {Map<string, object>} target - Destination map.
   * @param {{message?: string, file?: string, line?: number}} entry - Entry details.
   * @returns {void}
   */
  const recordEntry = (target, entry = {}) => {
    const key = entryKey(entry);
    const existing = target.get(key);

    if (existing) {
      existing.count += 1;
      return;
    }

    target.set(key, { ...entry, count: 1 });
  };

  return {
    recordDeprecation,

    recordWarning: (entry) => recordEntry(warnings, entry),

    recordError: (entry) => recordEntry(errors, entry),

    /**
     * Record one Sass import that could not be resolved.
     *
     * Keyed by the importing site and the specifier, because the same missing
     * partial reported through two entrypoints is one thing to fix.
     *
     * @param {{file?: string, line?: number, specifier?: string, statement?: string}} entry - Import error.
     * @returns {void}
     */
    recordImportError(entry = {}) {
      if (!entry.specifier) return;

      const key = `${entry.file || '?'}:${entry.line ?? '?'}|${entry.specifier}`;
      const existing = importErrors.get(key);

      if (existing) {
        existing.count += 1;
        return;
      }

      importErrors.set(key, { ...entry, count: 1 });
    },

    /**
     * Record one CSS minifier syntax failure.
     *
     * Keyed by the offending declaration, since the same broken rule reached
     * through several entrypoints is one thing to fix.
     *
     * @param {{minifier?: string, message?: string, declaration?: string}} entry - Syntax error.
     * @returns {void}
     */
    recordSyntaxError(entry = {}) {
      if (!entry.message) return;

      const key = `${entry.declaration || ''}|${entry.message}`;
      const existing = syntaxErrors.get(key);

      if (existing) {
        existing.count += 1;
        return;
      }

      syntaxErrors.set(key, { ...entry, count: 1 });
    },

    /**
     * Record one CSS `url()` that Vite could not resolve at build time.
     *
     * Keyed by URL, because the same asset referenced from two stylesheets with
     * different relative paths is two separate things for an author to fix.
     *
     * @param {{url?: string, importer?: string}} entry - Unresolved asset.
     * @returns {void}
     */
    recordUnresolvedAsset({ url, importer } = {}) {
      if (!url) return;

      const existing = unresolvedAssets.get(url);
      if (existing) {
        existing.count += 1;
        existing.importer = existing.importer || importer;
        return;
      }

      unresolvedAssets.set(url, { url, importer, count: 1 });
    },

    snapshot() {
      const deprecationList = [...deprecations.values()]
        .map((bucket) => ({
          id: bucket.id,
          occurrences: bucket.occurrences,
          locations: [...bucket.locations.values()].sort(byCountThenPath),
        }))
        .sort(
          (a, b) => b.occurrences - a.occurrences || a.id.localeCompare(b.id),
        );

      const distinctFiles = new Set();
      for (const bucket of deprecationList) {
        for (const location of bucket.locations) {
          if (location.file) distinctFiles.add(location.file);
        }
      }

      const errorList = [...errors.values()];
      const warningList = [...warnings.values()];
      const unresolvedAssetList = [...unresolvedAssets.values()].sort(
        (a, b) => b.count - a.count || a.url.localeCompare(b.url),
      );

      const importErrorList = [...importErrors.values()].sort(
        (a, b) =>
          String(a.file).localeCompare(String(b.file)) ||
          (a.line ?? 0) - (b.line ?? 0),
      );

      return {
        deprecations: deprecationList,
        deprecationsByFile: groupDeprecationsByFile(deprecationList),
        unresolvedAssets: unresolvedAssetList,
        importErrors: importErrorList,
        syntaxErrors: [...syntaxErrors.values()],
        warnings: warningList,
        errors: errorList,
        deprecationTotal: deprecationList.reduce(
          (total, bucket) => total + bucket.occurrences,
          0,
        ),
        deprecationFileCount: distinctFiles.size,
        hasProblems:
          errorList.length > 0 ||
          warningList.length > 0 ||
          deprecationList.length > 0 ||
          unresolvedAssetList.length > 0 ||
          importErrorList.length > 0 ||
          syntaxErrors.size > 0,
      };
    },

    /**
     * Whether any build error has been captured this cycle.
     *
     * The logger consults this before swallowing Rolldown's raw error dump, so
     * output is only suppressed once the reporter has something to show in its
     * place.
     *
     * Deliberately covers ordinary errors as well as missing imports. Scoping
     * it to imports alone meant a failure of any other kind — an undefined
     * mixin, say — was reported by the summary *and* dumped raw, so the one
     * error appeared twice.
     *
     * @returns {boolean} TRUE when any build error was captured.
     */
    hasCapturedBuildErrors: () =>
      importErrors.size > 0 || errors.size > 0 || syntaxErrors.size > 0,

    reset() {
      deprecations = new Map();
      warnings = new Map();
      errors = new Map();
      unresolvedAssets = new Map();
      importErrors = new Map();
      syntaxErrors = new Map();
    },
  };
}
