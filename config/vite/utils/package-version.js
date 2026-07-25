/**
 * @file Emulsify Core package version resolution.
 *
 * Shared by the component mirror plugin, which stamps the version into its
 * state marker, and the develop reporter, which prints it in the banner.
 */

import { join } from 'path';

import { safeReadJson } from './fs-safe.js';

/**
 * Resolve the installed Core package version.
 *
 * `import.meta.url` is deliberately avoided so Jest's CommonJS transform can
 * load callers of this module without extra plumbing. Candidates are ordered
 * from most to least specific: the consuming project's installed copy, the
 * current working directory's installed copy, then the working directory
 * itself for the case where Core is building its own source tree.
 *
 * @param {string} [projectDir] - Project directory running the build.
 * @returns {string} Emulsify Core package version, or `0.0.0` when unknown.
 */
export function resolvePackageVersion(projectDir) {
  const candidates = [
    projectDir && join(projectDir, 'node_modules/@emulsify/core/package.json'),
    join(process.cwd(), 'node_modules/@emulsify/core/package.json'),
    join(process.cwd(), 'package.json'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    const candidatePackage = safeReadJson(candidate).data;
    if (
      candidatePackage?.name === '@emulsify/core' &&
      candidatePackage.version
    ) {
      return candidatePackage.version;
    }
  }

  return '0.0.0';
}
