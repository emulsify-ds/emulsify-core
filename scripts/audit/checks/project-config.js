/**
 * @file Project configuration audit check.
 */

import { resolve } from 'node:path';
import { displayPath, makeFinding } from '../lib/findings.js';
import { safeIsDirectory } from '../lib/files.js';

/**
 * Audit basic project configuration and structure root health.
 *
 * @param {object} context - Audit context.
 * @returns {object[]} Findings.
 */
export function auditProjectConfig(context) {
  const { configExists, env, error, projectDir } = context;
  const findings = [];

  if (!configExists) {
    findings.push(
      makeFinding({
        id: 'missing-project-config',
        severity: 'error',
        message:
          'project.emulsify.json is missing, so platform and structure defaults may not match the project.',
        docs: 'https://github.com/emulsify-ds/emulsify-core/blob/4.x/docs/project-structure.md',
      }),
    );
  }

  if (error) {
    findings.push(
      makeFinding({
        id: 'project-config-resolution-failed',
        severity: 'error',
        message: `Unable to resolve project.emulsify.json: ${error.message || error}`,
      }),
    );
  }

  for (const implementation of env.structureImplementations || []) {
    if (!safeIsDirectory(implementation.directory)) {
      findings.push(
        makeFinding({
          id: 'missing-structure-implementation',
          severity: 'error',
          filePath: resolve(projectDir, 'project.emulsify.json'),
          message: `Configured structureImplementation "${implementation.name}" does not exist: ${displayPath(
            projectDir,
            implementation.directory,
          )}`,
          docs: 'https://github.com/emulsify-ds/emulsify-core/blob/4.x/docs/project-structure.md',
        }),
      );
    }
  }

  for (const root of env.ignoredAssetRoots || []) {
    findings.push(
      makeFinding({
        id: 'invalid-asset-root',
        severity: 'warn',
        filePath: resolve(projectDir, 'project.emulsify.json'),
        message: `Configured asset root "${root}" was ignored because it resolves outside the project root.`,
        docs: 'https://github.com/emulsify-ds/emulsify-core/blob/4.x/docs/project-structure.md#asset-roots',
      }),
    );
  }

  return findings;
}
