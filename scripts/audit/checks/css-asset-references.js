/**
 * @file CSS asset reference audit check.
 *
 * Emulsify's documented convention is a root-absolute `url('/assets/...')`.
 * Two other forms are common and both used to ship broken: a relative URL
 * authored against the emitted CSS location, and the bare `assets/...` form.
 * The build now repairs both when the target is unambiguous
 * (config/vite/plugins/assets/css-asset-rebase.js), so what this check reports
 * is (a) references nothing can resolve, and (b) references the build has to
 * repair, which are worth writing canonically in source.
 */

import { dirname, resolve } from 'node:path';
import { assetTailFor } from '../../../config/vite/plugins/assets/asset-url-rebase.js';
import { resolveAssetTail } from '../../../config/vite/utils/asset-roots.js';
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
  classifyCssAssetUrl,
  cssUrlPath,
  findCssUrlReferences,
  isNonFilesystemCssUrl,
  styleRuntimeDirectories,
} from '../lib/css.js';

const ASSET_DOCS =
  'https://github.com/emulsify-ds/emulsify-core/blob/4.x/docs/asset-references.md#sass-and-css';

/**
 * Build the fix payload an autofix can apply to the authored stylesheet.
 *
 * Interpolated URLs are deliberately unfixable: the edit belongs on the
 * variable declaration, and same-file variable scanning cannot see who else
 * depends on it.
 *
 * @param {string} filePath - Absolute stylesheet path.
 * @param {{raw: string, start: number, end: number}} ref - URL reference.
 * @param {string} replacement - Canonical URL.
 * @returns {object|undefined} Fix payload, when safe to apply.
 */
function makeUrlFix(filePath, ref, replacement) {
  if (ref.raw.includes('#{') || ref.raw === replacement) return undefined;

  return {
    filePath,
    start: ref.start,
    end: ref.end,
    original: ref.raw,
    replacement,
  };
}

/**
 * Build the finding for a CSS asset URL nothing can resolve.
 *
 * @param {object} params - Reference context.
 * @param {string} params.filePath - Absolute stylesheet path.
 * @param {string} [params.projectDir] - Absolute project root.
 * @param {object} params.ref - URL reference.
 * @param {object} params.resolution - Asset tail resolution.
 * @returns {object} Finding.
 */
function unresolvedFinding({ filePath, projectDir = '', ref, resolution }) {
  const ambiguous = resolution.status === 'ambiguous';

  return makeFinding({
    id: 'unresolved-css-asset-reference',
    severity: 'warn',
    filePath,
    line: ref.line,
    message: ambiguous
      ? `CSS asset URL "${ref.raw}" matches more than one project asset root.`
      : `CSS asset URL "${ref.raw}" could not be resolved from the source file or any project asset root.`,
    details: ambiguous
      ? [
          `Candidates: ${resolution.candidates
            .map((candidate) => displayPath(projectDir, candidate))
            .join(', ')}.`,
          'Remove the duplicate, or narrow assets.roots in project.emulsify.json so one file answers to the URL.',
        ]
      : [
          'Reference project assets with the canonical root form, url(/assets/...), and keep the file under assets/ or a root declared in project.emulsify.json assets.roots.',
          'Otherwise check the filename for a typo.',
        ],
    docs: ASSET_DOCS,
  });
}

/**
 * Audit a URL that names the published `assets/` prefix.
 *
 * @param {object} params - Reference context.
 * @param {string} params.assetPath - URL path without query or hash.
 * @param {string[]} params.assetRoots - Absolute project asset roots.
 * @param {string} params.filePath - Absolute stylesheet path.
 * @param {string} params.projectDir - Absolute project root.
 * @param {object} params.ref - URL reference.
 * @returns {object[]} Findings.
 */
function auditAssetRootReference({
  assetPath,
  assetRoots,
  filePath,
  projectDir,
  ref,
}) {
  const tail = assetTailFor(assetPath);
  const resolution = resolveAssetTail(tail, assetRoots);
  // A `?v=2` or `#id` suffix is part of the authored URL, not of the asset
  // path, so it survives the rewrite untouched.
  const canonical = `/assets/${tail}${ref.raw.slice(cssUrlPath(ref.raw).length)}`;

  if (resolution.status !== 'resolved') {
    return [unresolvedFinding({ filePath, projectDir, ref, resolution })];
  }

  // Already canonical: nothing to say.
  if (ref.raw === canonical) return [];

  return [
    makeFinding({
      id: 'css-runtime-asset-reference',
      severity: 'info',
      filePath,
      line: ref.line,
      message: `CSS asset URL "${ref.raw}" is not the canonical asset form, so the build has to repair it.`,
      details: [
        `Resolved asset: ${displayPath(projectDir, resolution.file)}.`,
        `Rewrite it as url(${canonical}).`,
        'Run `emulsify-audit --fix` to apply this automatically.',
      ],
      docs: ASSET_DOCS,
      fix: makeUrlFix(filePath, ref, canonical),
    }),
  ];
}

/**
 * Audit local CSS/Sass asset URLs against the project's asset roots.
 *
 * @param {object} context - Audit context.
 * @returns {object[]} Findings.
 */
export function auditCssAssetReferences(context) {
  const { env, projectDir, styleFiles } = context;
  const findings = [];
  const assetRoots = auditAssetRoots(env).filter(safeIsDirectory);
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

      const classification = classifyCssAssetUrl(ref.value);

      // Some other absolute URL: the platform serves it, and there is no
      // project file to check it against.
      if (classification === 'runtime') continue;

      if (classification === 'asset-root') {
        findings.push(
          ...auditAssetRootReference({
            assetPath,
            assetRoots,
            filePath,
            projectDir,
            ref,
          }),
        );
        continue;
      }

      const sourceAsset = firstExistingPath([
        resolve(dirname(filePath), assetPath),
      ]);
      const runtimeAsset = firstExistingPath(
        runtimeDirs.map((directory) => resolve(directory, assetPath)),
      );
      const resolvedAsset = sourceAsset || runtimeAsset;

      if (!resolvedAsset) {
        findings.push(
          unresolvedFinding({
            filePath,
            projectDir,
            ref,
            resolution: { status: 'missing' },
          }),
        );
        continue;
      }

      // A relative URL that only resolves once the CSS is emitted is exactly
      // the shape that breaks when the output shape changes.
      if (
        assetRoots.some((root) => isSameOrInside(resolvedAsset, root)) &&
        (!sourceAsset || runtimeAsset)
      ) {
        findings.push(
          makeFinding({
            id: 'css-runtime-asset-reference',
            severity: 'info',
            filePath,
            line: ref.line,
            message: `CSS asset URL "${ref.raw}" reaches project assets by a path that only resolves once the CSS is emitted.`,
            details: [
              `Resolved asset: ${displayPath(projectDir, resolvedAsset)}.`,
              'Write it as url(/assets/...) so the same source works in Storybook and in every emitted CSS location.',
            ],
            docs: ASSET_DOCS,
          }),
        );
      }
    }
  }

  return findings;
}
