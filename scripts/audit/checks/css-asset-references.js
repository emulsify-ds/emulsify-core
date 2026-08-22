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
import { createAuditFixTargetChecker } from '../fix.js';
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
 * @param {boolean} fixWritable - Whether audit policy permits a rewrite.
 * @returns {object|undefined} Fix payload, when safe to apply.
 */
function makeUrlFix(filePath, ref, replacement, fixWritable) {
  if (!fixWritable || ref.raw.includes('#{') || ref.raw === replacement) {
    return undefined;
  }

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
 * @param {Function} params.canFix - Lazily check whether policy permits a rewrite.
 * @param {string} params.projectDir - Absolute project root.
 * @param {object} params.ref - URL reference.
 * @returns {object[]} Findings.
 */
function auditAssetRootReference({
  assetPath,
  assetRoots,
  canFix,
  filePath,
  projectDir,
  ref,
}) {
  const tail = assetTailFor(assetPath);
  const resolution = resolveAssetTail(tail, assetRoots);

  if (resolution.status !== 'resolved') {
    return [unresolvedFinding({ filePath, projectDir, ref, resolution })];
  }

  const interpolated = ref.raw.includes('#{');
  // A `?v=2` or `#id` suffix is part of the authored URL, not of the asset
  // path, so it survives the rewrite untouched. Interpolation also begins
  // with `#`, but it is authored Sass rather than a URL fragment; deriving a
  // replacement from it would append the complete raw value as a suffix.
  const canonical = interpolated
    ? undefined
    : `/assets/${tail}${ref.raw.slice(cssUrlPath(ref.raw).length)}`;

  // Already canonical: nothing to say.
  if (ref.raw === canonical) return [];

  const fix = canonical
    ? makeUrlFix(filePath, ref, canonical, canFix())
    : undefined;
  const details = [
    `Resolved asset: ${displayPath(projectDir, resolution.file)}.`,
  ];

  if (canonical) {
    details.push(`Rewrite it as url(${canonical}).`);
  } else {
    details.push(
      'This URL contains Sass interpolation, so review its variable declaration instead of rewriting the reference automatically.',
    );
  }

  if (fix) {
    details.push('Run `emulsify-audit --fix` to apply this automatically.');
  }

  return [
    makeFinding({
      id: 'css-runtime-asset-reference',
      severity: 'info',
      filePath,
      line: ref.line,
      message: `CSS asset URL "${ref.raw}" is not the canonical asset form, so the build has to repair it.`,
      details,
      docs: ASSET_DOCS,
      fix,
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
  const sourceRoots = Array.isArray(context.sourceRoots)
    ? context.sourceRoots
    : env.projectStructure?.sourceRoots;
  const styleSourceRoots = sourceRoots || [];
  const isFixTargetWritable = createAuditFixTargetChecker({
    projectDir,
    sourceRoots,
  });

  for (const filePath of styleFiles) {
    if (
      styleSourceRoots.length &&
      !isInsideAnyRoot(filePath, styleSourceRoots)
    ) {
      continue;
    }

    let fixWritable;
    const canFix = () => {
      fixWritable ??= isFixTargetWritable(filePath);
      return fixWritable;
    };
    const source = cachedReadFile(filePath);
    const runtimeDirs = styleRuntimeDirectories(filePath, env, projectDir);

    for (const ref of findCssUrlReferences(source)) {
      if (isNonFilesystemCssUrl(ref.value)) continue;

      const assetPath = cssUrlPath(ref.value);
      if (!assetPath) continue;

      // CSS resolves non-absolute URLs from the source stylesheet first. The
      // build plugin only sees literals Vite already failed to resolve, but the
      // audit scans authored source and must preserve that precedence itself.
      // Do not probe `/assets/...` against the filesystem root: it is the
      // canonical project-asset form, not a source-relative path.
      const sourceAsset = assetPath.startsWith('/')
        ? undefined
        : firstExistingPath([resolve(dirname(filePath), assetPath)]);
      const classification = classifyCssAssetUrl(ref.value);

      // Some other absolute URL: the platform serves it, and there is no
      // project file to check it against.
      if (classification === 'runtime') continue;

      if (classification === 'asset-root') {
        // Rewriting a working local reference could select a different file
        // with the same tail under a project asset root. It needs no repair and
        // is deliberately ineligible for --fix.
        if (sourceAsset) continue;

        findings.push(
          ...auditAssetRootReference({
            assetPath,
            assetRoots,
            canFix,
            filePath,
            projectDir,
            ref,
          }),
        );
        continue;
      }

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
