/**
 * @file Files outside source roots audit check.
 */

import { displayPath, makeFinding } from '../lib/findings.js';
import { isInsideAnyRoot } from '../lib/files.js';

/**
 * Audit files that look like component Twig files outside source roots.
 *
 * @param {object} context - Audit context.
 * @returns {object[]} Findings.
 */
export function auditFilesOutsideRoots(context) {
  const { env, projectDir, twigFiles } = context;
  const roots = [
    ...(env.projectStructure?.twigRoots || []),
    ...(env.projectStructure?.sourceRoots || []),
  ];

  if (!roots.length) return [];

  return twigFiles
    .filter((filePath) => !isInsideAnyRoot(filePath, roots))
    .map((filePath) =>
      makeFinding({
        id: 'twig-file-outside-source-roots',
        severity: 'info',
        filePath,
        message:
          'Twig file is outside normalized source roots and will not be available to Storybook include()/source() unless another integration loads it.',
        docs: 'https://github.com/emulsify-ds/emulsify-core/blob/4.x/docs/project-structure.md',
      }),
    )
    .filter((finding) => !isNonComponentTwigFile(projectDir, finding.filePath));
}

/**
 * Determine whether a Twig file is intentionally outside component roots.
 *
 * @param {string} projectDir - Absolute project root.
 * @param {string} filePath - Absolute Twig file path.
 * @returns {boolean} TRUE when the file should not be treated as component source.
 */
function isNonComponentTwigFile(projectDir, filePath) {
  const relPath = displayPath(projectDir, filePath);

  return (
    relPath.startsWith('docs/') ||
    relPath.startsWith('templates/') ||
    relPath.includes('/templates/')
  );
}
