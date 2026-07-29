/**
 * @file Legacy Twig story audit check.
 */

import { analyzeStorySource } from '../../audit-twig-stories.js';
import { makeFinding } from '../lib/findings.js';
import { cachedReadFile } from '../lib/files.js';

/**
 * Add legacy Twig story migration findings.
 *
 * @param {object} context - Audit context.
 * @returns {object[]} Findings.
 */
export function auditLegacyTwigStories(context) {
  const { storyFiles } = context;
  const findings = storyFiles
    .map((filePath) => analyzeStorySource(cachedReadFile(filePath), filePath))
    .filter((result) => result.shouldUpgrade);

  return findings.map((finding) =>
    makeFinding({
      id: 'legacy-twig-story',
      severity: 'warn',
      filePath: finding.filePath,
      line: finding.directTemplateReturns[0]?.line,
      message:
        'Twig story appears to return an HTML string directly. This remains compatible, but renderTwig() is preferred for active migrations.',
      details: finding.reasons,
      docs: 'https://github.com/emulsify-ds/emulsify-core/blob/4.x/docs/storybook.md#legacy-twig-story-compatibility',
    }),
  );
}
