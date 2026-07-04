/**
 * @file Shared text helpers for CLI scripts.
 */

/**
 * Find the 1-based line number for a character index.
 *
 * @param {string} source - Source text.
 * @param {number} index - Character index.
 * @returns {number} 1-based line number.
 */
export function lineNumberAt(source, index) {
  return source.slice(0, index).split('\n').length;
}
