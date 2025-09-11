/* eslint-disable */

/**
 * @file Entries map builder for Vite/Rollup.
 * @description Recreates the Webpack-style multi-entry generation for JS and SCSS,
 *              preserving Emulsify’s output folder structure.
 */

import fs from 'fs';
import { resolve, sep } from 'path';
import { globSync } from 'glob';

/**
 * Normalize filesystem paths to POSIX for Rollup keys.
 *
 * @param {string} p - A platform-specific file path.
 * @returns {string} POSIX-normalized path.
 */
export const toPosix = (p) => p.split(sep).join('/');

/**
 * Remove characters that would confuse Rollup naming or file systems.
 *
 * @param {string} inputPath - An entry key or path.
 * @returns {string} Sanitized path.
 */
export const sanitizePath = (inputPath) =>
  inputPath.replace(/[^a-zA-Z0-9/_-]/g, '');

/**
 * Replace the last slash in a string with a subpath (used to insert /css/ or /js/).
 *
 * @param {string} str - The path string to modify.
 * @param {string} replacement - The replacement string (e.g., "/css/").
 * @returns {string} Modified path.
 */
export function replaceLastSlash(str, replacement) {
  const lastSlashIndex = str.lastIndexOf('/');
  if (lastSlashIndex === -1) return str;
  return str.slice(0, lastSlashIndex) + replacement + str.slice(lastSlashIndex + 1);
}

/**
 * @typedef {Object} BuildContext
 * @property {string} projectDir - Absolute path to the project root.
 * @property {string} srcDir - Absolute path to the "src" (or "components") root.
 * @property {boolean} srcExists - Whether a "src" directory exists.
 * @property {boolean} isDrupal - Whether the target platform is Drupal.
 */

/**
 * Construct glob patterns matching the original Webpack config logic.
 *
 * @param {BuildContext} ctx - Build context references.
 * @returns {{
 *   BaseScssPattern: string,
 *   ComponentScssPattern: string,
 *   ComponentLibraryScssPattern: string,
 *   BaseJsPattern: string,
 *   ComponentJsPattern: string,
 *   SpritePattern: string
 * }}
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

  // Icons
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
 * Build a Rollup/Vite input map from Emulsify file structure.
 * Keys are **output paths without extensions** (e.g., "dist/components/foo/css/foo"),
 * values are absolute source file paths.
 *
 * @param {BuildContext} ctx - Build context (projectDir, srcDir, srcExists, isDrupal).
 * @param {ReturnType<makePatterns>} patterns - Glob patterns created by {@link makePatterns}.
 * @returns {Record<string, string>} A map suitable for `build.rollupOptions.input`.
 */
export function buildInputs(ctx, patterns) {
  const { srcDir, srcExists, isDrupal } = ctx;
  const {
    BaseJsPattern,
    ComponentJsPattern,
    BaseScssPattern,
    ComponentScssPattern,
    ComponentLibraryScssPattern,
  } = patterns;

  /** @type {Record<string, string>} */
  const inputs = {};

  /**
   * Add one entry safely after sanitizing.
   *
   * @param {string} key - Rollup name (path without extension).
   * @param {string} file - Absolute source filepath.
   */
  const addInput = (key, file) => {
    const sanitized = sanitizePath(toPosix(key));
    if (sanitized && !Object.prototype.hasOwnProperty.call(inputs, sanitized)) {
      inputs[sanitized] = file;
    }
  };

  // --- Non-component/global JS ---
  if (BaseJsPattern) {
    globSync(toPosix(BaseJsPattern)).forEach((file) => {
      const rel = toPosix(file).split(`${toPosix(srcDir)}/`)[1];
      const parts = rel.split('/');
      const outPath = `${parts.slice(0, -1).join('/')}/js/${parts.at(-1).replace(/\.js$/, '')}`;
      const key = srcExists ? `dist/global/${outPath}` : `dist/js/${outPath}`;
      addInput(key, file);
    });
  }

  // --- Component JS ---
  globSync(toPosix(ComponentJsPattern)).forEach((file) => {
    const splitA = toPosix(file).split(`${toPosix(srcDir)}/components/`)[1];
    const rel = splitA ?? toPosix(file).split(`${toPosix(srcDir)}/`)[1];
    const distRaw = replaceLastSlash(rel, '/js/').replace(/\.js$/, '');
    const prefix = isDrupal && srcExists ? 'components' : 'dist/components';
    const key = `${prefix}/${distRaw}`;
    addInput(key, file);
  });

  // --- Non-component/global SCSS ---
  if (BaseScssPattern) {
    globSync(toPosix(BaseScssPattern)).forEach((file) => {
      const rel = toPosix(file).split(`${toPosix(srcDir)}/`)[1];
      const parts = rel.split('/');
      const outPath = `${parts.slice(0, -1).join('/')}/css/${parts.at(-1).replace(/\.scss$/, '')}`;
      const key = srcExists ? `dist/global/${outPath}` : `dist/css/${outPath}`;
      addInput(key, file);
    });
  }

  // --- Component SCSS ---
  globSync(toPosix(ComponentScssPattern)).forEach((file) => {
    const splitA = toPosix(file).split(`${toPosix(srcDir)}/components/`)[1];
    const rel = splitA ?? toPosix(file).split(`${toPosix(srcDir)}/`)[1];
    const distRaw = replaceLastSlash(rel, '/css/').replace(/\.scss$/, '');
    const prefix = isDrupal && srcExists ? 'components' : 'dist/components';
    const key = `${prefix}/${distRaw}`;
    addInput(key, file);
  });

  // --- Component Library (Storybook/CL) SCSS ---
  globSync(toPosix(ComponentLibraryScssPattern)).forEach((file) => {
    const rel = toPosix(file).split(`${toPosix(srcDir)}/`)[1];
    const key = `dist/storybook/${rel.replace(/\.scss$/, '')}`;
    addInput(key, file);
  });

  return inputs;
}

/**
 * Convenience wrapper to build inputs directly from a projectDir.
 *
 * @param {string} projectDir - Absolute path to the project root.
 * @param {boolean} [isDrupal=false] - Whether the project targets Drupal behavior.
 * @returns {Record<string, string>} Inputs map for Rollup.
 */
export function buildInputsFromProject(projectDir, isDrupal = false) {
  const srcPath = resolve(projectDir, 'src');
  const srcExists = fs.existsSync(srcPath);
  const srcDir = srcExists ? srcPath : resolve(projectDir, 'components');

  const ctx = { projectDir, srcDir, srcExists, isDrupal };
  const patterns = makePatterns(ctx);
  return buildInputs(ctx, patterns);
}
