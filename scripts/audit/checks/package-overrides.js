/**
 * @file Package override audit check.
 */

import { resolve } from 'node:path';
import {
  safeExists,
  safeReadJson,
} from '../../../config/vite/utils/fs-safe.js';
import { makeFinding } from '../lib/findings.js';
import {
  hasRecommendedOverride,
  packageUsesEmulsifyCore,
} from '../lib/package-json.js';

const RECOMMENDED_PACKAGE_OVERRIDES = [
  {
    label: 'glob',
    value: '^13.0.6',
    paths: [['glob']],
  },
  {
    label: 'locutus',
    value: '^3.0.36',
    paths: [['locutus']],
  },
  {
    label: 'minimatch@3.0.x',
    value: '^3.1.5',
    paths: [['minimatch@3.0.x']],
  },
];

/**
 * Audit package-level dependency override policy for installed projects.
 *
 * npm only applies `overrides` from the root package being installed. When
 * Emulsify Core is installed into a generated theme, Core's own overrides do
 * not protect that theme's transitive dependency graph.
 *
 * @param {object} context - Audit context.
 * @returns {object[]} Findings.
 */
export function auditPackageOverrides(context) {
  const { projectDir } = context;
  const packagePath = resolve(projectDir, 'package.json');

  if (!safeExists(packagePath)) {
    return [];
  }

  const { data: packageJson, error } = safeReadJson(packagePath);
  if (error) {
    return [
      makeFinding({
        id: 'package-json-unreadable',
        severity: 'warn',
        filePath: packagePath,
        message: `Unable to parse package.json: ${error.message || error}`,
      }),
    ];
  }

  if (!packageUsesEmulsifyCore(packageJson)) {
    return [];
  }

  const overrides = packageJson.overrides || {};
  const missing = RECOMMENDED_PACKAGE_OVERRIDES.filter(
    (recommendation) => !hasRecommendedOverride(overrides, recommendation),
  );

  if (!missing.length) {
    return [];
  }

  return [
    makeFinding({
      id: 'recommended-package-overrides-missing',
      severity: 'warn',
      filePath: packagePath,
      message:
        'package.json is missing recommended root npm overrides for Emulsify Core transitive install warnings.',
      details: missing.map(
        (recommendation) =>
          `Add overrides.${recommendation.label}: ${recommendation.value}.`,
      ),
      docs: 'https://github.com/emulsify-ds/emulsify-core/blob/4.x/docs/migration-4x.md#install-warning-controls',
    }),
  ];
}
