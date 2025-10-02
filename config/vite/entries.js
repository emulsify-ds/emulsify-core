/* eslint-disable */

/**
 * @file Entries map builder for Vite/Rollup.
 * @description
 * Produces a keyed input map where each **key** (Rollup `[name]`) directly
 * encodes the desired output location relative to `outDir`:
 *
 * - Globals → `global/...`
 * - Components → `components/...`
 * - Storybook/CL → `storybook/...`
 *
 * Simplifications:
 * - No `singleDirectoryComponents` flag. We default to **single-directory style**
 *   (no `/css` or `/js` buckets). To avoid name collisions when a component has
 *   both JS and CSS, CSS keys get a `__style` suffix which is stripped in
 *   `vite.config.js -> assetFileNames`.
 * - No `isDrupal` flag from config; Drupal mirroring happens in a plugin that
 *   checks `env.platform === 'drupal'`.
 */

import fs from 'fs';
import { resolve, sep } from 'path';
import { globSync } from 'glob';

/** Suffix used for CSS entries to avoid collisions with JS stems. */
const CSS_SUFFIX = '__style';

/**
 * Normalize a path to POSIX (forward slashes).
 * @param {string} p
 * @returns {string}
 */
export const toPosix = (p) => p.split(sep).join('/');

/**
 * Sanitize a Rollup name/path (strip odd characters).
 * @param {string} s
 * @returns {string}
 */
export const sanitizePath = (s) => s.replace(/[^a-zA-Z0-9/_-]/g, '');

/**
 * Replace the last slash with a subpath (unused in SDC default, kept for parity).
 * @param {string} str
 * @param {string} replacement
 * @returns {string}
 */
export function replaceLastSlash(str, replacement) {
  const i = str.lastIndexOf('/');
  if (i === -1) return str;
  return str.slice(0, i) + replacement + str.slice(i + 1);
}

/**
 * @typedef {Object} BuildContext
 * @property {string} projectDir - Absolute project root.
 * @property {string} srcDir     - Absolute source root.
 * @property {boolean} srcExists - Whether `src/` exists.
 * @property {string} platform   - Platform string (e.g., 'drupal' or 'generic').
 */

/**
 * @typedef {Object} PatternSet
 * @property {string} BaseScssPattern
 * @property {string} ComponentScssPattern
 * @property {string} ComponentLibraryScssPattern
 * @property {string} BaseJsPattern
 * @property {string} ComponentJsPattern
 * @property {string} SpritePattern
 */

/**
 * Build glob patterns used to discover inputs.
 * @param {BuildContext} ctx
 * @returns {PatternSet}
 */
export function makePatterns(ctx) {
  const { projectDir, srcDir, srcExists } = ctx;

  // SCSS
  const BaseScssPattern = srcExists
    ? resolve(srcDir, '!(components|util)/**/!(_*|cl-*|sb-*).scss')
    : '';
  const ComponentScssPattern = srcExists
    ? resolve(srcDir, 'components/**/!(_*|cl-*|sb-*).scss')
    : resolve(srcDir, '**/!(_*|cl-*|sb-*).scss');
  const ComponentLibraryScssPattern = resolve(srcDir, '**/*{cl-*,sb-*}.scss');

  // JS
  const BaseJsPattern = srcExists
    ? resolve(srcDir, '!(components|util)/**/!(*.stories|*.component|*.min|*.test).js')
    : '';
  const ComponentJsPattern = srcExists
    ? resolve(srcDir, 'components/**/!(*.stories|*.component|*.min|*.test).js')
    : resolve(srcDir, '**/!(*.stories|*.component|*.min|*.test).js');

  // Icons (not used directly; kept for parity)
  const SpritePattern = resolve(projectDir, 'assets/icons/**/*.svg');

  return {
    BaseScssPattern,
    ComponentScssPattern,
    ComponentLibraryScssPattern,
    BaseJsPattern,
    ComponentJsPattern,
    SpritePattern,
  };
}

/**
 * Build the keyed input map for Rollup/Vite.
 * Keys encode the destination path (no extension), values are absolute sources.
 *
 * @param {BuildContext} ctx
 * @param {PatternSet} patterns
 * @returns {Record<string, string>}
 */
export function buildInputs(ctx, patterns) {
  const { srcDir } = ctx;
  const {
    BaseJsPattern,
    ComponentJsPattern,
    BaseScssPattern,
    ComponentScssPattern,
    ComponentLibraryScssPattern,
  } = patterns;

  /** @type {Record<string, string>} */
  const inputs = {};
  const SRC_POSIX = toPosix(srcDir);

  /**
   * Add a unique input key/value.
   * @param {string} key
   * @param {string} abs
   */
  const add = (key, abs) => {
    const k = sanitizePath(toPosix(key).replace(/^\/+/, ''));
    if (k && !Object.prototype.hasOwnProperty.call(inputs, k)) inputs[k] = abs;
  };

  /**
   * Convert an absolute path to a POSIX path relative to `srcDir`.
   * @param {string} abs
   * @returns {string}
   */
  const relFromSrc = (abs) => {
    const posix = toPosix(abs);
    const needle = `${SRC_POSIX}/`;
    return posix.startsWith(needle) ? posix.slice(needle.length) : posix;
  };

  /**
   * Compute the output stem (Rollup `[name]`) in **single-directory** style.
   * CSS gets a `__style` suffix to avoid collisions with same-stem JS.
   * @param {string} rel - POSIX relative path including extension.
   * @param {'css'|'js'} kind
   * @returns {string} stem without extension
   */
  const singleDirStem = (rel, kind) => {
    const withoutExt = rel.replace(/\.(scss|js)$/i, '');
    return kind === 'css' ? `${withoutExt}${CSS_SUFFIX}` : withoutExt;
  };

  /* ----------------------------- Base / Global JS ----------------------------- */
  if (BaseJsPattern) {
    for (const file of globSync(toPosix(BaseJsPattern))) {
      const rel = relFromSrc(file);
      add(`global/${singleDirStem(rel, 'js')}`, file);
    }
  }

  /* ----------------------------- Component JS -------------------------------- */
  for (const file of globSync(toPosix(ComponentJsPattern))) {
    const posix = toPosix(file);
    const idx = posix.indexOf('/components/');
    const after = idx !== -1 ? posix.slice(idx + '/components/'.length) : relFromSrc(file);
    add(`components/${singleDirStem(`components/${after}`, 'js').replace(/^components\//, '')}`, file);
  }

  /* --------------------------- Base / Global SCSS ---------------------------- */
  if (BaseScssPattern) {
    for (const file of globSync(toPosix(BaseScssPattern))) {
      const rel = relFromSrc(file);
      add(`global/${singleDirStem(rel, 'css')}`, file);
    }
  }

  /* --------------------------- Component SCSS -------------------------------- */
  for (const file of globSync(toPosix(ComponentScssPattern))) {
    const posix = toPosix(file);
    const idx = posix.indexOf('/components/');
    const after = idx !== -1 ? posix.slice(idx + '/components/'.length) : relFromSrc(file);
    add(`components/${singleDirStem(`components/${after}`, 'css').replace(/^components\//, '')}`, file);
  }

  /* ----------------- Component Library (Storybook / CL) ---------------------- */
  for (const file of globSync(toPosix(ComponentLibraryScssPattern))) {
    const rel = relFromSrc(file).replace(/\.scss$/i, '');
    add(`storybook/${rel}`, file);
  }

  return inputs;
}

/**
 * Convenience wrapper to build inputs from only `projectDir`.
 * @param {string} projectDir
 * @param {string} [platform='generic']
 * @returns {Record<string, string>}
 */
export function buildInputsFromProject(projectDir, platform = 'generic') {
  const srcPath = resolve(projectDir, 'src');
  const srcExists = fs.existsSync(srcPath);
  const srcDir = srcExists ? srcPath : resolve(projectDir, 'components');

  const ctx = { projectDir, srcDir, srcExists, platform };
  const patterns = makePatterns(ctx);
  return buildInputs(ctx, patterns);
}
