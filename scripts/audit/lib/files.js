/**
 * @file Filesystem helpers for the project audit.
 */

import { lstatSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { globSync } from 'glob';
import {
  safeExists,
  safeReadFile,
} from '../../../config/vite/utils/fs-safe.js';

export const DEFAULT_IGNORES = [
  '**/.coverage/**',
  '**/.git/**',
  '**/.github/**',
  '**/.out/**',
  '**/dist/**',
  '**/*.min.css',
  '**/*.test.{js,jsx,ts,tsx,mjs,cjs}',
  '**/node_modules/**',
  '**/scripts/audit.js',
  '**/vendor/**',
];

/**
 * Cache source file reads for one top-level audit run.
 *
 * @type {Map<string, string|null>}
 */
const fileReadCache = new Map();

/**
 * Clear the per-run source file read cache.
 *
 * @returns {void}
 */
export function resetFileReadCache() {
  fileReadCache.clear();
}

/**
 * Read a text source file once per top-level audit run.
 *
 * Missing files are cached as null internally but still return an empty string
 * to preserve safeReadFile() behavior for existing checks.
 *
 * @param {string} filePath - Absolute or relative file path.
 * @returns {string} File contents, or an empty string when unavailable.
 */
export function cachedReadFile(filePath) {
  const absPath = resolve(filePath);
  if (fileReadCache.has(absPath)) {
    return fileReadCache.get(absPath) ?? '';
  }

  const source = safeReadFile(absPath);
  const cachedSource = source === '' && !safeExists(absPath) ? null : source;
  fileReadCache.set(absPath, cachedSource);

  return cachedSource ?? '';
}

/**
 * Determine whether a candidate is a directory.
 *
 * @param {string} filePath - Absolute path.
 * @returns {boolean} TRUE when the path is a directory.
 */
export function safeIsDirectory(filePath) {
  try {
    return lstatSync(filePath).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Collect files from a project.
 *
 * @param {string} projectDir - Absolute project root.
 * @param {string|string[]} patterns - Glob pattern or patterns.
 * @returns {string[]} Absolute file paths.
 */
export function collectProjectFiles(projectDir, patterns) {
  return globSync(patterns, {
    cwd: projectDir,
    nodir: true,
    absolute: true,
    ignore: DEFAULT_IGNORES,
  })
    .map((filePath) => resolve(filePath))
    .sort();
}

/**
 * Return a normalized, project-contained root list.
 *
 * @param {string} projectDir - Absolute project root.
 * @param {string[]} roots - Absolute candidate roots.
 * @returns {string[]} Existing roots inside the project.
 */
export function normalizeAuditRoots(projectDir, roots = []) {
  const resolvedProject = resolve(projectDir);

  return Array.from(
    new Set(
      roots
        .filter(Boolean)
        .map((root) => resolve(root))
        .filter(
          (root) =>
            isSameOrInside(root, resolvedProject) && safeIsDirectory(root),
        ),
    ),
  ).sort();
}

/**
 * Collect files from normalized audit roots only.
 *
 * @param {string} projectDir - Absolute project root.
 * @param {string|string[]} patterns - Glob pattern or patterns.
 * @param {string[]} roots - Absolute roots to scan.
 * @returns {string[]} Absolute file paths.
 */
export function collectRootedProjectFiles(projectDir, patterns, roots = []) {
  const files = new Set();

  for (const root of normalizeAuditRoots(projectDir, roots)) {
    for (const filePath of globSync(patterns, {
      cwd: root,
      nodir: true,
      absolute: true,
      ignore: DEFAULT_IGNORES,
    })) {
      files.add(resolve(filePath));
    }
  }

  return Array.from(files).sort();
}

/**
 * Determine whether a file is inside one of the roots.
 *
 * @param {string} filePath - Absolute file path.
 * @param {string[]} roots - Absolute roots.
 * @returns {boolean} TRUE when inside a root.
 */
export function isInsideAnyRoot(filePath, roots = []) {
  return roots.some((root) => {
    const rel = relative(root, filePath);
    return Boolean(rel) && !rel.startsWith('..') && !rel.includes(`..${sep}`);
  });
}

/**
 * Determine whether a path is the same as, or inside, a root directory.
 *
 * @param {string} filePath - Absolute file path.
 * @param {string} root - Absolute root path.
 * @returns {boolean} TRUE when the path is inside or equal to the root.
 */
export function isSameOrInside(filePath, root) {
  const rel = relative(root, filePath);
  return !rel || (!rel.startsWith('..') && !rel.includes(`..${sep}`));
}
