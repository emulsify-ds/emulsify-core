/**
 * @file Twig volume audit check.
 */

import { resolve } from 'node:path';
import { globSync } from 'glob';
import { directorySize } from '../../lib/fs.js';
import { makeFinding } from '../lib/findings.js';
import { DEFAULT_IGNORES, safeIsDirectory } from '../lib/files.js';

const TWIG_GLOB = '**/*.twig';

/**
 * Audit Twig volume under Storybook roots.
 *
 * @param {object} context - Audit context.
 * @returns {object[]} Findings.
 */
export function auditTwigVolume(context) {
  const { env, twigThreshold } = context;
  const roots = Array.from(new Set(env.projectStructure?.twigRoots || []));
  const twigFiles = new Set();

  for (const root of roots) {
    if (!safeIsDirectory(root)) continue;
    for (const filePath of globSync(TWIG_GLOB, {
      cwd: root,
      absolute: true,
      nodir: true,
      ignore: DEFAULT_IGNORES,
    })) {
      twigFiles.add(resolve(filePath));
    }
  }

  if (twigFiles.size <= twigThreshold) return [];

  const totalBytes = roots.reduce(
    (total, root) => total + directorySize(root),
    0,
  );

  return [
    makeFinding({
      id: 'large-twig-storybook-roots',
      severity: 'info',
      message: `${twigFiles.size} Twig files are under Storybook Twig roots. Eager Twig imports are reliable but can increase Storybook startup/build cost for large libraries.`,
      details: [
        `Approximate Twig root size: ${Math.round(totalBytes / 1024)} KB.`,
      ],
      docs: 'https://github.com/emulsify-ds/emulsify-core/blob/4.x/docs/performance.md#storybook-twig-imports',
    }),
  ];
}
