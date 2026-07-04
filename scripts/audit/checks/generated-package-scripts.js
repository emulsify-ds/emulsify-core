/**
 * @file Generated package script audit check.
 */

import { resolve } from 'node:path';
import {
  safeExists,
  safeReadJson,
} from '../../../config/vite/utils/fs-safe.js';
import { makeFinding } from '../lib/findings.js';
import {
  packageIsEmulsifyCore,
  packageUsesEmulsifyCore,
} from '../lib/package-json.js';

const GENERATED_PACKAGE_SCRIPT_DOCS =
  'https://github.com/emulsify-ds/emulsify-core/blob/4.x/docs/migration-4x.md#manual-packagejson-updates';

/**
 * Audit generated-theme package scripts that must be updated manually.
 *
 * Generated themes copy their root package.json from the starter at creation
 * time. Whisk updates do not automatically flow into existing themes, so the
 * audit flags stale Webpack-era scripts and missing Core 4 audit/Vite scripts.
 *
 * @param {object} context - Audit context.
 * @returns {object[]} Findings.
 */
export function auditGeneratedPackageScripts(context) {
  const { env, projectDir } = context;
  const packagePath = resolve(projectDir, 'package.json');

  if (!safeExists(packagePath)) {
    return [];
  }

  const { data: packageJson, error } = safeReadJson(packagePath);
  if (error || !packageUsesEmulsifyCore(packageJson)) {
    return [];
  }

  if (packageIsEmulsifyCore(packageJson)) {
    return [];
  }

  const scripts = packageJson.scripts || {};
  const starterRepository = env.projectConfig?.starter?.repository;
  const fromGeneratedStarter =
    typeof starterRepository === 'string' &&
    /emulsify-(drupal|wordpress|craftcms|starter)|emulsify-ds/i.test(
      starterRepository,
    );
  const usesGeneratedCoreScripts = Object.values(scripts).some(
    (script) =>
      typeof script === 'string' &&
      /node_modules\/@emulsify\/core\/(?:config\/(?:webpack|vite)|scripts\/audit)/.test(
        script,
      ),
  );

  if (!fromGeneratedStarter && !usesGeneratedCoreScripts) {
    return [];
  }

  const findings = [];
  const details = [];
  const buildScript = scripts.build || '';

  if (/\bwebpack\b|config\/webpack/.test(buildScript)) {
    details.push('Replace scripts.build with the Vite build command.');
  } else if (
    /node_modules\/@emulsify\/core\/config\/vite\/vite\.config\.js/.test(
      buildScript,
    ) &&
    /\bvite\s+(?:--config|-c)\b/.test(buildScript)
  ) {
    details.push('Replace scripts.build with the Vite build command.');
  }

  if (Object.prototype.hasOwnProperty.call(scripts, 'build-dev')) {
    details.push('Remove scripts.build-dev; the Vite build replaces it.');
  }

  if (/\bwebpack\b|npm:webpack|config\/webpack/.test(scripts.develop || '')) {
    details.push('Replace scripts.develop with the Vite/Storybook watcher.');
  }

  if (Object.prototype.hasOwnProperty.call(scripts, 'webpack')) {
    details.push('Replace scripts.webpack with scripts.vite.');
  }

  for (const scriptName of ['audit', 'audit:twig-stories', 'vite']) {
    if (!Object.prototype.hasOwnProperty.call(scripts, scriptName)) {
      details.push(`Add scripts.${scriptName}.`);
    }
  }

  if (details.length) {
    findings.push(
      makeFinding({
        id: 'generated-package-json-migration-needed',
        severity: 'warn',
        filePath: packagePath,
        message:
          'package.json does not match the generated-theme scripts expected by Emulsify Core 4.',
        details,
        docs: GENERATED_PACKAGE_SCRIPT_DOCS,
      }),
    );
  }

  return findings;
}
