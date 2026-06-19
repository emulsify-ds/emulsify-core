/**
 * @file Entries map builder for Vite/Rollup.
 *
 * Builds a keyed input map (for `build.rollupOptions.input`) where the map key
 * encodes the final folder inside the Vite outDir (default `dist/`).
 *
 * Modern projects:
 *   - Global/base assets -> "global/..."
 *   - Component assets   -> "components/..." (or mirrored to ./components when Drupal)
 *   - SDC=true removes the injected "/css" or "/js" bucket
 *
 * Component Structure Overrides projects (project.emulsify.json: variant.structureImplementations):
 *   - Only compile JS/SCSS.
 *   - JS  -> "js/<relative-without-ext>"
 *   - CSS -> "css/<relative-without-ext>"
 *   - Twig/assets copying is handled by plugins using the same structure model.
 *   - cl-* / sb-* SCSS -> "storybook/<path-without-ext>"
 */

import fs from 'fs';
import { basename, resolve } from 'path';
import {
  compiledAssetOutputPath,
  resolveProjectStructure,
  storybookStyleOutputPath,
} from './project-structure.js';
import { createSourceFileIndex } from './plugins/source-file-index.js';
import { replaceLastSlash, toPosix } from './utils/paths.js';

export { replaceLastSlash, toPosix };

/** Remove characters that would confuse Rollup naming or file systems. */
export const sanitizePath = (s) => s.replace(/[^a-zA-Z0-9/_-]/g, '');

/**
 * @typedef {Object} BuildContext
 * @property {string} projectDir
 * @property {string} srcDir
 * @property {boolean} srcExists
 * @property {boolean} isDrupal - kept for downstream logic parity
 * @property {boolean} SDC
 * @property {boolean} structureOverrides
 * @property {string[]} [structureRoots]
 * @property {object} [sourceFileIndex]
 */

/* -------------------------------------------------------------------------- */
/* Utilities                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Safe map setter that avoids prototype pollution keys.
 * @param {Record<string,string>} map
 * @param {string} key
 * @param {string} value
 */
function safeSetKey(map, key, value) {
  const forbidden = ['__proto__', 'prototype', 'constructor'];
  if (!key || forbidden.some((bad) => key.includes(bad))) return;
  map[key] = value;
}

/** Return an absolute path from a source index entry or string. */
const entryPath = (entry) =>
  typeof entry === 'string' ? entry : entry.absPath;

/** Determine whether a file should be compiled as a JS entry. */
const isJavaScriptEntry = (entry) => {
  const filePath = entryPath(entry);
  return (
    /\.jsx?$/.test(filePath) &&
    !/\.(stories|component|min|test)\.jsx?$/.test(filePath)
  );
};

/** Determine whether a file should be compiled as a regular SCSS entry. */
const isScssEntry = (entry) => {
  const filePath = entryPath(entry);
  const name = basename(filePath);
  return (
    /\.scss$/.test(name) &&
    !name.startsWith('_') &&
    !name.startsWith('cl-') &&
    !name.startsWith('sb-')
  );
};

/** Determine whether a file should be emitted under the Storybook style path. */
const isStorybookScssEntry = (entry) => {
  const filePath = entryPath(entry);
  return /\.scss$/.test(filePath) && /(?:cl-|sb-)/.test(basename(filePath));
};

/* -------------------------------------------------------------------------- */
/* Inputs builder                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Build the Rollup/Vite input map.
 *
 * Keys are paths **relative to outDir**, without extensions. Examples:
 *   - "global/layout/css/layout"
 *   - "components/accordion/js/accordion" (or without "/js" when SDC=true)
 *
 * For Component Structure Overrides (variant.structureImplementations present),
 * only JS/CSS keys are produced under "js/**" and "css/**".
 *
 * @param {BuildContext} ctx
 * @returns {Record<string, string>}
 */
export function buildInputs(ctx) {
  const structure = ctx.projectStructure || resolveProjectStructure(ctx);
  const sourceFileIndex =
    ctx.sourceFileIndex || createSourceFileIndex(structure);

  /** @type {Record<string, string>} */
  const inputs = {};

  /**
   * Add a key/file pair into the inputs map safely (sanitized + POSIX).
   * @param {string|null} key
   * @param {string} abs
   */
  const add = (key, abs) => {
    if (!key) return;
    const clean = sanitizePath(toPosix(key)).replace(/^\/+/, '');
    if (!clean) return;
    safeSetKey(inputs, clean, abs);
  };

  /* ------------------------------------------------------------------------ */
  /* STRUCTURE OVERRIDES BRANCH                                               */
  /* ------------------------------------------------------------------------ */
  if (structure.structureOverrides) {
    // Gather JS and SCSS from each declared variant root directory.
    const componentFiles = sourceFileIndex.componentFiles();
    const jsFiles = componentFiles.filter(isJavaScriptEntry);
    const scssFiles = componentFiles.filter(isScssEntry);
    const storybookScss = componentFiles.filter(isStorybookScssEntry);

    // JS files emit under dist/js using the path below components when possible.
    for (const entry of jsFiles) {
      const file = entryPath(entry);
      add(compiledAssetOutputPath(file, 'js', structure, ctx), file);
    }

    // SCSS files emit under dist/css using the same relative path rules.
    for (const entry of scssFiles) {
      const file = entryPath(entry);
      add(compiledAssetOutputPath(file, 'css', structure, ctx), file);
    }

    // Storybook and component-library styles stay under dist/storybook.
    for (const entry of storybookScss) {
      const file = entryPath(entry);
      add(storybookStyleOutputPath(file, structure, ctx), file);
    }

    return inputs;
  }

  /* ------------------------------------------------------------------------ */
  /* MODERN BRANCH (existing behavior preserved)                              */
  /* ------------------------------------------------------------------------ */
  const globalFiles = sourceFileIndex.globalFiles();
  const componentFiles = sourceFileIndex.componentFiles();

  // Global JS
  for (const entry of globalFiles.filter(isJavaScriptEntry)) {
    const file = entryPath(entry);
    add(compiledAssetOutputPath(file, 'js', structure, ctx), file);
  }

  // Component JS
  for (const entry of componentFiles.filter(isJavaScriptEntry)) {
    const file = entryPath(entry);
    add(compiledAssetOutputPath(file, 'js', structure, ctx), file);
  }

  // Global SCSS
  for (const entry of globalFiles.filter(isScssEntry)) {
    const file = entryPath(entry);
    add(compiledAssetOutputPath(file, 'css', structure, ctx), file);
  }

  // Component SCSS
  for (const entry of componentFiles.filter(isScssEntry)) {
    const file = entryPath(entry);
    add(compiledAssetOutputPath(file, 'css', structure, ctx), file);
  }

  // Storybook/CL SCSS
  for (const entry of sourceFileIndex.all().filter(isStorybookScssEntry)) {
    const file = entryPath(entry);
    add(storybookStyleOutputPath(file, structure, ctx), file);
  }

  return inputs;
}

/**
 * Convenience wrapper that infers `srcDir` and returns an inputs map.
 * @param {string} projectDir
 * @param {boolean} [isDrupal=false]
 * @param {boolean} [SDC=false]
 * @returns {Record<string,string>}
 */
export function buildInputsFromProject(
  projectDir,
  isDrupal = false,
  SDC = false,
) {
  const srcPath = resolve(projectDir, 'src');
  const srcExists = fs.existsSync(srcPath);
  const srcDir = srcExists ? srcPath : resolve(projectDir, 'components');

  const ctx = {
    projectDir,
    srcDir,
    srcExists,
    isDrupal,
    SDC,
    structureOverrides: false,
    structureRoots: [],
  };
  return buildInputs(ctx);
}
