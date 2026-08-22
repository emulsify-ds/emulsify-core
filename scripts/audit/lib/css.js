/**
 * @file CSS and Sass URL parsing helpers for the project audit.
 */

import { basename, dirname, resolve } from 'node:path';
import { assetTailFor } from '../../../config/vite/plugins/assets/asset-url-rebase.js';
import { tokenizeStylesheetUrls } from '../../../config/vite/utils/css-urls.js';
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
 * Extract URL references from CSS or Sass source.
 *
 * `start` and `end` bracket the specifier *without* its quotes, so an autofix
 * can splice a replacement in without disturbing quote style. The shared
 * tokenizer preserves original positions, so `source.slice(start, end) === raw`.
 *
 * @param {string} source - Stylesheet source.
 * @returns {{value: string, raw: string, quote: string, line: number, start: number, end: number}[]} URL references.
 */
export function findCssUrlReferences(source) {
  const { urls, sourceWithoutComments } = tokenizeStylesheetUrls(source);
  const variables = findSassStringVariables(sourceWithoutComments);
  const references = [];

  for (const token of urls) {
    const raw = token.value;
    const value = resolveSassUrlValue(raw, variables).trim();

    references.push({
      value,
      raw,
      quote: token.quote,
      line: lineNumberAt(source, token.start),
      start: token.valueStart,
      end: token.valueEnd,
    });
  }

  return references;
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
