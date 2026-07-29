/**
 * @file Twig reference audit check.
 */

import { resolve } from 'node:path';
import { makeFinding } from '../lib/findings.js';
import { cachedReadFile } from '../lib/files.js';
import {
  findTwigIncludeSourceReferences,
  findTwigNamespaceReferences,
  resolvesTwigReference,
} from '../lib/twig.js';

/**
 * Audit Twig namespace and include/source resolution.
 *
 * @param {object} context - Audit context.
 * @returns {object[]} Findings.
 */
export function auditTwigReferences(context) {
  const { env, projectDir, twigFiles } = context;
  const namespaceRoots = env.namespaceRoots || {};
  const knownNamespaces = new Set([...Object.keys(namespaceRoots), 'assets']);
  const findings = [];
  const seen = new Set();

  for (const twigFile of twigFiles) {
    const source = cachedReadFile(twigFile);

    for (const ref of findTwigNamespaceReferences(source)) {
      if (knownNamespaces.has(ref.namespace)) continue;

      const key = `${twigFile}:${ref.line}:unknown:${ref.namespace}`;
      if (seen.has(key)) continue;
      seen.add(key);

      findings.push(
        makeFinding({
          id: 'unknown-twig-namespace',
          severity: 'warn',
          filePath: twigFile,
          line: ref.line,
          message: `Twig namespace "@${ref.namespace}" is not configured in the normalized project structure.`,
          docs: 'https://github.com/emulsify-ds/emulsify-core/blob/4.x/docs/project-structure.md#twig-namespaces',
        }),
      );
    }

    for (const ref of findTwigIncludeSourceReferences(source)) {
      if (!resolvesTwigReference(ref.value, twigFile, env)) {
        findings.push(
          makeFinding({
            id: 'unresolved-twig-reference',
            severity: 'warn',
            filePath: twigFile,
            line: ref.line,
            message: `${ref.type}() reference "${ref.value}" could not be resolved from the normalized Twig roots.`,
            docs: 'https://github.com/emulsify-ds/emulsify-core/blob/4.x/docs/storybook.md#include',
          }),
        );
      }
    }
  }

  return findings.map((finding) => ({
    ...finding,
    filePath: finding.filePath || resolve(projectDir, 'project.emulsify.json'),
  }));
}
