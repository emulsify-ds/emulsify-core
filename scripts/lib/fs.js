/**
 * @file Shared filesystem helpers for CLI scripts.
 */

import { readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Recursively measure a directory size.
 *
 * Unreadable directories contribute only the bytes already counted before the
 * filesystem error, matching the audit script's historical safe behavior.
 *
 * @param {string} directory - Directory path.
 * @returns {number} Size in bytes.
 */
export function directorySize(directory) {
  let total = 0;

  try {
    for (const entry of readdirSync(directory)) {
      const entryPath = resolve(directory, entry);
      const stats = statSync(entryPath);
      total += stats.isDirectory() ? directorySize(entryPath) : stats.size;
    }
  } catch {
    return total;
  }

  return total;
}
