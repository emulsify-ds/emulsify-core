/**
 * @file Shared project asset root resolution.
 *
 * Three places used to keep their own copy of "where does `/assets/...` come
 * from": the audit (`scripts/audit/lib/twig.js`), the Twig source() virtual
 * module (`config/vite/plugins/twig/virtual-twig-asset-sources.js`), and
 * Storybook's static mounts (`.storybook/main-static-assets.js`). They
 * disagreed on precedence, so the audit could name a root that Storybook
 * shadowed. This module is the single list; every caller delegates here.
 *
 * Precedence is configured `assets.roots` first, then root `assets/`, then
 * `src/assets/` — the order Storybook actually serves at `/assets`, which is
 * what an author's `url('/assets/...')` resolves against at review time.
 */

import { statSync } from 'fs';
import { isAbsolute, relative, resolve, sep, win32 } from 'path';

import { safeExists, safeRealPath } from './fs-safe.js';
import { toPosixPath } from './paths.js';
import { unique } from '../../../src/extensions/shared/lists.js';

/**
 * Asset roots every project gets, whether or not `assets.roots` is configured.
 *
 * @type {string[]}
 */
export const DEFAULT_ASSET_ROOTS = ['assets', 'src/assets'];

/**
 * Build output roots, opt-in because a build that resolved through its own
 * previous output would not be reproducible from a clean tree.
 *
 * @type {string[]}
 */
export const GENERATED_ASSET_ROOTS = ['dist/assets'];

/**
 * Determine whether a path is the same as a directory or inside it.
 *
 * @param {string} candidate - Absolute candidate path.
 * @param {string} directory - Absolute directory path.
 * @returns {boolean} TRUE when the candidate cannot escape the directory.
 */
function isSameOrInside(candidate, directory) {
  if (candidate === directory) return true;
  const rel = relative(directory, candidate);

  // On Windows, `relative()` returns the target unchanged when it sits on
  // another volume — `relative('C:\\p\\assets', 'D:\\out\\x.svg')` is
  // `'D:\\out\\x.svg'`, and a UNC share behaves the same way. Neither result
  // begins with `..`, so the checks below would read an escape as containment.
  if (isAbsolute(rel)) return false;

  return Boolean(rel) && !rel.startsWith('..') && !rel.includes(`..${sep}`);
}

/**
 * Determine whether an asset tail names a volume instead of a relative path.
 *
 * A tail is everything after the `assets/` prefix in an authored URL, so it is
 * relative by construction. A drive-qualified (`D:/x.svg`), drive-relative
 * (`D:x.svg`), or UNC (`\\server\share\x.svg`) tail is therefore malformed,
 * and on Windows `resolve()` would switch away from the asset root. That also
 * rejects a POSIX-legal first segment such as `x:y.png`: it is syntactically
 * indistinguishable from a Windows drive-relative path. Windows semantics are
 * checked on every platform so the API remains portable and testable in CI.
 *
 * @param {string} tail - Asset path relative to an asset root.
 * @returns {boolean} TRUE when the tail escapes any root it is resolved from.
 */
function isVolumeQualified(tail) {
  return isAbsolute(tail) || Boolean(win32.parse(tail).root);
}

/**
 * Determine whether an asset candidate is a regular file.
 *
 * @param {string} candidate - Absolute candidate path.
 * @returns {boolean} TRUE when the candidate is a file.
 */
function isFile(candidate) {
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

/**
 * Resolve an asset root declaration to an absolute filesystem path.
 *
 * Accepts the three forms consumers write: an absolute filesystem path, a
 * project-relative path (`./design-system/assets`), and Vite's root-relative
 * form (`/assets`), which is what `project.emulsify.json` and Storybook use.
 * An absolute-looking root that neither sits inside the project nor exists on
 * disk is reinterpreted as root-relative, matching the behavior both previous
 * copies had.
 *
 * @param {string} projectDir - Absolute project root.
 * @param {string} assetRoot - Absolute, project-relative, or root-relative root.
 * @returns {string} Absolute filesystem path, or an empty string.
 */
export function toAbsoluteAssetRoot(projectDir, assetRoot) {
  if (typeof assetRoot !== 'string') return '';

  const trimmed = assetRoot.trim().replace(/[/\\]+$/, '');
  if (!trimmed) return '';

  const base = resolve(projectDir || process.cwd());

  if (isAbsolute(trimmed)) {
    const absolute = resolve(trimmed);
    if (isSameOrInside(absolute, base) || safeExists(absolute)) {
      return absolute;
    }

    // Vite root-relative: "/assets" means "<projectDir>/assets".
    return resolve(base, `.${toPosixPath(trimmed)}`);
  }

  return resolve(base, trimmed);
}

/**
 * Resolve the ordered asset roots for a project.
 *
 * @param {{projectDir?: string, projectStructure?: {assetRoots?: string[]}}} [env={}] - Emulsify environment.
 * @param {object} [options={}] - Resolution options.
 * @param {boolean} [options.includeGenerated=false] - Append `dist/assets`.
 * @param {boolean} [options.existingOnly=true] - Drop roots absent from disk.
 * @returns {string[]} Absolute asset roots, in precedence order.
 */
export function resolveAssetRoots(
  env = {},
  { includeGenerated = false, existingOnly = true } = {},
) {
  const projectDir = env?.projectDir || process.cwd();
  const configured = Array.isArray(env?.projectStructure?.assetRoots)
    ? env.projectStructure.assetRoots
    : [];

  const roots = unique(
    [
      ...configured,
      ...DEFAULT_ASSET_ROOTS,
      ...(includeGenerated ? GENERATED_ASSET_ROOTS : []),
    ]
      .map((root) => toAbsoluteAssetRoot(projectDir, root))
      .filter(Boolean),
  );

  return existingOnly ? roots.filter((root) => safeExists(root)) : roots;
}

/**
 * Resolve a published asset path (the part after `/assets/`) against the roots.
 * The tail must already be relative and portable across POSIX and Windows;
 * leading separators and Windows volume syntax are rejected as malformed.
 *
 * Overlapping roots are normal — a project can declare `./assets` explicitly
 * and still pick up the implicit root — so candidates are collapsed by their
 * canonical path before ambiguity is decided. A genuine ambiguity means two
 * different files answer to one URL, which no caller may guess at.
 *
 * @param {string} tail - Asset path relative to an asset root.
 * @param {string[]} [roots=[]] - Absolute asset roots, in precedence order.
 * @returns {{status: 'resolved'|'ambiguous'|'missing', file?: string, root?: string, candidates: string[]}} Resolution.
 */
export function resolveAssetTail(tail, roots = []) {
  const cleaned = String(tail || '').trim();
  if (!cleaned || isVolumeQualified(cleaned)) {
    return { status: 'missing', candidates: [] };
  }

  const seen = new Set();
  /** @type {{file: string, root: string}[]} */
  const matches = [];

  for (const root of roots) {
    const candidate = resolve(root, cleaned);

    // A tail such as `../../etc/passwd` must not escape its root.
    if (!isSameOrInside(candidate, root)) continue;
    if (!isFile(candidate)) continue;

    const key = safeRealPath(candidate);
    if (seen.has(key)) continue;

    seen.add(key);
    matches.push({ file: candidate, root });
  }

  if (!matches.length) return { status: 'missing', candidates: [] };

  const candidates = matches.map((match) => match.file);
  if (matches.length > 1) return { status: 'ambiguous', candidates };

  return {
    status: 'resolved',
    file: matches[0].file,
    root: matches[0].root,
    candidates,
  };
}
