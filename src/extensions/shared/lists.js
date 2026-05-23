/**
 * @file List coercion utilities shared by extension implementations.
 * @module extensions/shared/lists
 */

/**
 * Convert scalar or nested array values into a flat list.
 *
 * @param {*} value - Value to flatten.
 * @returns {*[]} Flat list with null, undefined, and false treated as empty.
 */
export function flattenList(value) {
  if (value === null || typeof value === 'undefined' || value === false) {
    // Match Twig-style falsey class handling without discarding 0 or ''.
    return [];
  }

  if (!Array.isArray(value)) {
    return [value];
  }

  return value.flatMap((item) => flattenList(item));
}

/**
 * Return values in their first-seen order with duplicates removed.
 *
 * @param {*[]} values - Values to deduplicate.
 * @returns {*[]} Unique values.
 */
export function uniqueList(values) {
  const seen = new Set();
  const result = [];

  for (const value of values) {
    // Preserve first-seen order; class order can affect utility CSS output.
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }

  return result;
}
