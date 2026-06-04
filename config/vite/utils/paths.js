/**
 * @file Shared filesystem path helpers for Vite config and scripts.
 */

import { sep } from 'path';

/**
 * Normalize a filesystem path to POSIX separators.
 *
 * Splitting on the host separator preserves existing path behavior on Windows,
 * while the backslash replacement also normalizes Windows-style paths handled
 * on non-Windows hosts.
 *
 * @param {string} filePath - Filesystem path.
 * @returns {string} Path using forward slashes.
 */
export function toPosix(filePath) {
  return filePath.split(sep).join('/').replace(/\\/g, '/');
}

/**
 * Normalize a filesystem path to POSIX separators.
 *
 * @param {string} filePath - Filesystem path.
 * @returns {string} Path using forward slashes.
 */
export const toPosixPath = toPosix;

/**
 * Replace the final slash in a POSIX path with a custom segment.
 *
 * @param {string} filePath - POSIX-style path.
 * @param {string} replacement - Replacement string for the final slash.
 * @returns {string} Path with the final slash replaced, or the original path.
 */
export function replaceLastSlash(filePath, replacement) {
  const index = filePath.lastIndexOf('/');
  if (index === -1) return filePath;
  return filePath.slice(0, index) + replacement + filePath.slice(index + 1);
}
