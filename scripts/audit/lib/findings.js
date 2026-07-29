/**
 * @file Finding and report-path helpers for the project audit.
 */

import { relative } from 'node:path';
import { toPosixPath } from '../../../config/vite/utils/paths.js';

/**
 * Return a project-relative path for report output.
 *
 * @param {string} projectDir - Absolute project root.
 * @param {string} filePath - Absolute file path.
 * @returns {string} Project-relative POSIX path.
 */
export function displayPath(projectDir, filePath) {
  return toPosixPath(relative(projectDir, filePath));
}

/**
 * Build a report finding.
 *
 * @param {object} finding - Finding details.
 * @returns {object} Normalized finding.
 */
export function makeFinding(finding) {
  return {
    severity: 'warn',
    docs: undefined,
    ...finding,
  };
}
