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
 *   snapshot: () => {
 *     deprecations: Array<{id: string, occurrences: number, locations: Array<{file: string|undefined, line: number|undefined, count: number}>}>,
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

      return {
        deprecations: deprecationList,
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
          deprecationList.length > 0,
      };
    },

    reset() {
      deprecations = new Map();
      warnings = new Map();
      errors = new Map();
    },
  };
}
