/**
 * @file Safe filesystem helpers for Vite config and scripts.
 */

import { existsSync, readFileSync, realpathSync } from 'fs';

/**
 * Determine whether a path exists without throwing on inaccessible files.
 *
 * @param {string} filePath - Absolute or relative filesystem path.
 * @returns {boolean} TRUE when the path exists.
 */
export function safeExists(filePath) {
  try {
    return existsSync(filePath);
  } catch {
    return false;
  }
}

/**
 * Read a file without throwing when it is missing or inaccessible.
 *
 * @param {string} filePath - Absolute or relative filesystem path.
 * @param {BufferEncoding} [encoding='utf8'] - File encoding.
 * @returns {string} File contents, or an empty string when unavailable.
 */
export function safeReadFile(filePath, encoding = 'utf8') {
  try {
    return readFileSync(filePath, encoding);
  } catch {
    return '';
  }
}

/**
 * Read and parse a JSON file without throwing on missing files.
 *
 * Missing or empty files return an empty object. Invalid JSON returns the parse
 * error so callers that report diagnostics can preserve that behavior.
 *
 * @param {string} filePath - Absolute or relative JSON file path.
 * @returns {{data?: *, error?: Error}} Parsed result or parse error.
 */
export function safeReadJson(filePath) {
  const source = safeReadFile(filePath);
  if (!source) {
    return {};
  }

  try {
    return { data: JSON.parse(source) };
  } catch (error) {
    return { error };
  }
}

/**
 * Return the first existing path from a candidate list.
 *
 * @param {string[]} candidates - Candidate filesystem paths.
 * @returns {string|undefined} First existing path, when found.
 */
export function firstExistingPath(candidates = []) {
  return candidates.filter(Boolean).find((candidate) => safeExists(candidate));
}

/**
 * Resolve symlinks without throwing on missing or inaccessible paths.
 *
 * Used to tell "two asset roots that overlap" apart from "two different files
 * with the same name", so an overlapping root configuration is not mistaken for
 * an ambiguous asset reference.
 *
 * @param {string} filePath - Absolute or relative filesystem path.
 * @returns {string} Canonical path, or the input path when unavailable.
 */
export function safeRealPath(filePath) {
  try {
    return realpathSync(filePath);
  } catch {
    return filePath;
  }
}
