/**
 * @file Story discovery audit check.
 */

import { collectStoryFiles } from '../../audit-twig-stories.js';
import { makeFinding } from '../lib/findings.js';

/**
 * Audit story files that will not be discovered by Storybook.
 *
 * @param {object} context - Audit context.
 * @returns {object[]} Findings.
 */
export function auditStoryDiscovery(context) {
  const { projectDir, storyFiles } = context;
  const discovered = new Set(collectStoryFiles(projectDir));
  const findings = [];

  for (const storyFile of storyFiles) {
    if (discovered.has(storyFile)) continue;

    findings.push(
      makeFinding({
        id: 'story-outside-discovered-roots',
        severity: 'error',
        filePath: storyFile,
        message:
          'Story file is outside the normalized Storybook roots and will not be discovered.',
        docs: 'https://github.com/emulsify-ds/emulsify-core/blob/4.x/docs/project-structure.md',
      }),
    );
  }

  return findings;
}
