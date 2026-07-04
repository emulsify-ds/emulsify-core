/**
 * @file CSS and Sass URL parsing helpers for the project audit.
 */

import { basename, dirname, resolve } from 'node:path';
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
 * @param {string} source - Stylesheet source.
 * @returns {{value: string, raw: string, line: number}[]} URL references.
 */
export function findCssUrlReferences(source) {
  const scanSource = maskStyleComments(source);
  const variables = findSassStringVariables(scanSource);
  const references = [];
  const pattern = /url\(\s*(?:(['"])(.*?)\1|([^'")][^)]*?))\s*\)/g;

  for (const match of scanSource.matchAll(pattern)) {
    const raw = (match[2] ?? match[3] ?? '').trim();
    const value = resolveSassUrlValue(raw, variables).trim();

    references.push({
      value,
      raw,
      line: lineNumberAt(source, match.index || 0),
    });
  }

  return references;
}

/**
 * Determine whether a CSS URL should be skipped by filesystem checks.
 *
 * @param {string} value - URL value.
 * @returns {boolean} TRUE when the URL is not a local relative asset path.
 */
export function isNonFilesystemCssUrl(value) {
  return (
    !value ||
    value.startsWith('#') ||
    value.startsWith('/') ||
    value.startsWith('//') ||
    value.startsWith('$') ||
    value.startsWith('#{') ||
    /^[a-z][a-z0-9+.-]*:/i.test(value) ||
    /^var\(/i.test(value) ||
    /^env\(/i.test(value)
  );
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
