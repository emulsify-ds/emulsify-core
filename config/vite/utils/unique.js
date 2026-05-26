/**
 * @file Shared array de-duplication helpers.
 */

/**
 * Return values in first-seen order with duplicates removed.
 *
 * @template T
 * @param {T[]} values - Values to deduplicate.
 * @returns {T[]} Unique values.
 */
export function unique(values = []) {
  return Array.from(new Set(values));
}

/**
 * Return values in first-seen order with duplicates removed by key.
 *
 * @template T
 * @param {T[]} values - Values to deduplicate.
 * @param {(value: T) => *} keyFn - Function that returns a comparable key.
 * @returns {T[]} Unique values.
 */
export function uniqueBy(values = [], keyFn) {
  const seen = new Set();
  const result = [];

  for (const value of values) {
    const key = keyFn(value);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }

  return result;
}
