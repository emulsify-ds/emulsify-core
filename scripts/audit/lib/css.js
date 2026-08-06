/**
 * @file CSS and Sass URL parsing helpers for the project audit.
 */

import { basename, dirname, resolve } from 'node:path';
import { assetTailFor } from '../../../config/vite/plugins/assets/asset-url-rebase.js';
import {
  compiledAssetOutputPath,
  storybookStyleOutputPath,
} from '../../../config/vite/project-structure.js';
import { lineNumberAt } from '../../lib/text.js';

/**
 * Extract simple same-file Sass string variables.
 *
 * @param {string} source - Stylesheet source.
 * @returns {Map<string, string>} Variable value map.
 */
function findSassStringVariables(source) {
  const variables = new Map();
  const pattern = /^\s*\$([\w-]+)\s*:\s*(['"])(.*?)\2\s*;?/gm;

  for (const match of source.matchAll(pattern)) {
    variables.set(match[1], match[3]);
  }

  return variables;
}

/**
 * Resolve same-file Sass variable interpolation in a URL value.
 *
 * This intentionally handles only simple string variables. It is enough to make
 * common asset roots such as `#{$font-url}/Avenir.woff2` auditable without
 * pretending to be a Sass compiler.
 *
 * @param {string} value - Raw URL value.
 * @param {Map<string, string>} variables - Sass variable map.
 * @returns {string} URL value with known interpolations expanded.
 */
function resolveSassUrlValue(value, variables) {
  return value.replace(/#\{\$([\w-]+)\}/g, (match, name) =>
    variables.has(name) ? variables.get(name) : match,
  );
}

/**
 * Mask style comments while preserving line and character positions.
 *
 * @param {string} source - Stylesheet source.
 * @returns {string} Source with comments replaced by whitespace.
 */
function maskStyleComments(source) {
  const blank = (match) => match.replace(/[^\n]/g, ' ');

  return source
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/^[\t ]*\/\/.*$/gm, blank);
}

/**
 * Extract URL references from CSS or Sass source.
 *
 * `start` and `end` bracket the specifier *without* its quotes, so an autofix
 * can splice a replacement in without disturbing quote style. Comment masking
 * preserves positions, so offsets taken from the scanned copy are valid in the
 * original source: `source.slice(start, end) === raw`.
 *
 * @param {string} source - Stylesheet source.
 * @returns {{value: string, raw: string, line: number, start: number, end: number}[]} URL references.
 */
export function findCssUrlReferences(source) {
  const scanSource = maskStyleComments(source);
  const variables = findSassStringVariables(scanSource);
  const references = [];
  const pattern = /url\(\s*(?:(['"])(.*?)\1|([^'")][^)]*?))\s*\)/dg;

  for (const match of scanSource.matchAll(pattern)) {
    const untrimmed = match[2] ?? match[3] ?? '';
    const [groupStart] = match.indices?.[2] ??
      match.indices?.[3] ?? [match.index || 0];
    const raw = untrimmed.trim();
    const start =
      groupStart + (untrimmed.length - untrimmed.trimStart().length);
    const value = resolveSassUrlValue(raw, variables).trim();

    references.push({
      value,
      raw,
      line: lineNumberAt(source, match.index || 0),
      start,
      end: start + raw.length,
    });
  }

  return references;
}

/**
 * Determine whether a CSS URL can never name a file on disk.
 *
 * Absolute paths used to be lumped in here, which meant the documented
 * `/assets/...` convention was never validated at all — a typo in
 * `/assets/images/typoo.jpg` was caught by nothing. Classification of absolute
 * URLs now lives in `classifyCssAssetUrl`; this stays the pure transport test.
 *
 * @param {string} value - URL value.
 * @returns {boolean} TRUE when the URL is not a filesystem path.
 */
export function isNonFilesystemCssUrl(value) {
  return (
    !value ||
    value.startsWith('#') ||
    value.startsWith('//') ||
    value.startsWith('$') ||
    // Anywhere, not just at position 0: an expanded `$font-url` leaves the
    // interpolation mid-string, and guessing at it is how false findings start.
    value.includes('#{') ||
    /^[a-z][a-z0-9+.-]*:/i.test(value) ||
    /^var\(/i.test(value) ||
    /^env\(/i.test(value)
  );
}

/**
 * Classify how a filesystem-ish CSS URL should be resolved.
 *
 * - `asset-root` — `/assets/...` or `assets/...`. Resolved against the project
 *   asset roots, which is what Storybook serves and what the build rebases to.
 * - `runtime` — some other absolute URL (`/sites/default/files/...`). The
 *   platform serves it; the audit has nothing to check.
 * - `relative` — resolved from the stylesheet's own directory.
 *
 * @param {string} value - URL value.
 * @returns {'asset-root'|'runtime'|'relative'} Resolution strategy.
 */
export function classifyCssAssetUrl(value) {
  if (assetTailFor(cssUrlPath(value))) return 'asset-root';

  return value.startsWith('/') ? 'runtime' : 'relative';
}

/**
 * Remove query string and hash suffixes from a URL path.
 *
 * @param {string} value - URL value.
 * @returns {string} Path portion.
 */
export function cssUrlPath(value) {
  return value.split(/[?#]/)[0];
}

/**
 * Resolve an emitted CSS output key to the actual CSS file path.
 *
 * Vite entry keys use `__style` internally to avoid JS/CSS collisions. The
 * shared Vite config removes that suffix from emitted CSS file names.
 *
 * @param {string} key - Output key without extension.
 * @returns {string} Emitted CSS file path relative to output root.
 */
function emittedCssRelativePath(key) {
  return `${key.replace(/__style$/i, '')}.css`;
}

/**
 * Return possible runtime directories for a style file's emitted CSS.
 *
 * @param {string} filePath - Source stylesheet.
 * @param {object} env - Normalized environment.
 * @param {string} projectDir - Project root.
 * @returns {string[]} Absolute runtime directories.
 */
export function styleRuntimeDirectories(filePath, env, projectDir) {
  if (!/\.(scss|sass|css)$/i.test(filePath)) return [];
  if (basename(filePath).startsWith('_')) return [];

  const structure = env.projectStructure || {};
  if (!structure.output) return [];

  const ctx = {
    projectDir,
    srcDir: env.srcDir || resolve(projectDir, 'src'),
    SDC: Boolean(env.SDC),
  };
  const fileName = basename(filePath);
  const isStorybookStyle = /^(cl-|sb-)/.test(fileName);
  const key = isStorybookStyle
    ? storybookStyleOutputPath(filePath, structure, ctx)
    : compiledAssetOutputPath(filePath, 'css', structure, ctx);

  if (!key) return [];

  const relCss = emittedCssRelativePath(key);
  const directories = [dirname(resolve(projectDir, 'dist', relCss))];

  if (structure.mirrorComponentOutput && relCss.startsWith('components/')) {
    directories.push(dirname(resolve(projectDir, relCss)));
  }

  return Array.from(new Set(directories));
}
