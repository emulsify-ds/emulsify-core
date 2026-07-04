/**
 * @file Drupal assumption audit check.
 */

import { lineNumberAt } from '../../lib/text.js';
import { makeFinding } from '../lib/findings.js';
import { cachedReadFile } from '../lib/files.js';

/**
 * Audit Drupal assumptions in non-Drupal projects.
 *
 * @param {object} context - Audit context.
 * @returns {object[]} Findings.
 */
export function auditDrupalAssumptions(context) {
  const { codeFiles, env } = context;
  if (env.platform === 'drupal') return [];

  const findings = [];
  const patterns = [
    /\bDrupal\.attachBehaviors\b/,
    /\bwindow\.Drupal\b/,
    /\bglobalThis\.Drupal\b/,
    /['"][^'"]*_drupal\.js['"]/,
    /['"]twig-drupal-filters['"]/,
  ];

  for (const filePath of codeFiles) {
    const source = cachedReadFile(filePath);
    const match = patterns.map((pattern) => pattern.exec(source)).find(Boolean);

    if (!match) continue;

    findings.push(
      makeFinding({
        id: 'drupal-assumption-non-drupal',
        severity: 'warn',
        filePath,
        line: lineNumberAt(source, match.index || 0),
        message:
          'Drupal-specific Storybook/runtime code was found, but the active platform is not drupal.',
        docs: 'https://github.com/emulsify-ds/emulsify-core/blob/4.x/docs/platform-adapters.md',
      }),
    );
  }

  return findings;
}
