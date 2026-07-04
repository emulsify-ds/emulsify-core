/**
 * @file Core import audit check.
 */

import { lineNumberAt } from '../../lib/text.js';
import { makeFinding } from '../lib/findings.js';
import { cachedReadFile } from '../lib/files.js';

const PUBLIC_CORE_IMPORTS = new Set([
  '@emulsify/core',
  '@emulsify/core/extensions',
  '@emulsify/core/extensions/react',
  '@emulsify/core/extensions/twig',
  '@emulsify/core/package.json',
  '@emulsify/core/storybook',
  '@emulsify/core/vite',
  '@emulsify/core/vite/plugins',
]);

/**
 * Extract import specifiers from JavaScript source.
 *
 * @param {string} source - JavaScript source.
 * @returns {{specifier: string, index: number}[]} Import specifiers.
 */
function findImportSpecifiers(source) {
  const imports = [];
  const patterns = [
    /(?:import|export)\s+(?:[^'"]+\s+from\s+)?['"]([^'"]+)['"]/g,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      imports.push({
        specifier: match[1],
        index: match.index || 0,
      });
    }
  }

  return imports;
}

/**
 * Audit direct imports of Emulsify Core internals.
 *
 * @param {object} context - Audit context.
 * @returns {object[]} Findings.
 */
export function auditCoreImports(context) {
  const { codeFiles } = context;
  const findings = [];

  for (const filePath of codeFiles) {
    const source = cachedReadFile(filePath);

    for (const item of findImportSpecifiers(source)) {
      const { specifier } = item;
      if (!specifier.startsWith('@emulsify/core/')) continue;
      if (PUBLIC_CORE_IMPORTS.has(specifier)) continue;

      findings.push(
        makeFinding({
          id: 'internal-core-import',
          severity: 'warn',
          filePath,
          line: lineNumberAt(source, item.index),
          message: `Import "${specifier}" uses an internal Emulsify Core path. Prefer a public package export.`,
          docs: 'https://github.com/emulsify-ds/emulsify-core/blob/4.x/README.md#public-imports',
        }),
      );
    }
  }

  return findings;
}
