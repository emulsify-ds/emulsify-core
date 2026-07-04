/**
 * @file CSS asset reference audit check.
 */

import { dirname, resolve } from 'node:path';
import { firstExistingPath } from '../../../config/vite/utils/fs-safe.js';
import { displayPath, makeFinding } from '../lib/findings.js';
import {
  cachedReadFile,
  isInsideAnyRoot,
  isSameOrInside,
  safeIsDirectory,
} from '../lib/files.js';
import { auditAssetRoots } from '../lib/twig.js';
import {
  cssUrlPath,
  findCssUrlReferences,
  isNonFilesystemCssUrl,
  styleRuntimeDirectories,
} from '../lib/css.js';

/**
 * Audit local CSS/Sass asset URLs that Vite may leave to runtime resolution.
 *
 * @param {object} context - Audit context.
 * @returns {object[]} Findings.
 */
export function auditCssAssetReferences(context) {
  const { env, projectDir, styleFiles } = context;
  const findings = [];
  const projectAssetRoots = auditAssetRoots(env).filter(safeIsDirectory);
  const styleSourceRoots = env.projectStructure?.sourceRoots || [];

  for (const filePath of styleFiles) {
    if (
      styleSourceRoots.length &&
      !isInsideAnyRoot(filePath, styleSourceRoots)
    ) {
      continue;
    }

    const source = cachedReadFile(filePath);
    const runtimeDirs = styleRuntimeDirectories(filePath, env, projectDir);

    for (const ref of findCssUrlReferences(source)) {
      if (isNonFilesystemCssUrl(ref.value)) continue;

      const assetPath = cssUrlPath(ref.value);
      if (!assetPath) continue;

      const sourceAsset = firstExistingPath([
        resolve(dirname(filePath), assetPath),
      ]);
      const runtimeAsset = firstExistingPath(
        runtimeDirs.map((directory) => resolve(directory, assetPath)),
      );
      const resolvedAsset = sourceAsset || runtimeAsset;

      if (!resolvedAsset) {
        findings.push(
          makeFinding({
            id: 'unresolved-css-asset-reference',
            severity: 'warn',
            filePath,
            line: ref.line,
            message: `CSS asset URL "${ref.raw}" could not be resolved from the source file or expected emitted CSS location.`,
            details: [
              'Check for a typo, move the asset into a source-root-relative location Vite can resolve, or rewrite the URL to a stable Drupal/theme public path.',
            ],
            docs: 'https://github.com/emulsify-ds/emulsify-core/blob/4.x/docs/migration-4x.md#css-asset-urls',
          }),
        );
        continue;
      }

      if (
        projectAssetRoots.some((root) => isSameOrInside(resolvedAsset, root)) &&
        (!sourceAsset || runtimeAsset || assetPath.startsWith('..'))
      ) {
        findings.push(
          makeFinding({
            id: 'css-runtime-asset-reference',
            severity: 'info',
            filePath,
            line: ref.line,
            message: `CSS asset URL "${ref.raw}" resolves to project-level assets and may be left unchanged by Vite for runtime resolution.`,
            details: [
              `Resolved asset: ${displayPath(projectDir, resolvedAsset)}.`,
              'This is acceptable when Drupal serves the asset at that runtime URL. To make Vite bundle or rebase it, move the asset under a source root and reference it from the authored stylesheet.',
            ],
            docs: 'https://github.com/emulsify-ds/emulsify-core/blob/4.x/docs/migration-4x.md#css-asset-urls',
          }),
        );
      }
    }
  }

  return findings;
}
