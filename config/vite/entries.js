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
import { resolve } from 'path';
import { globSync } from 'glob';
import {
  compiledAssetOutputPath,
  resolveProjectStructure,
  storybookStyleOutputPath,
} from './project-structure.js';
import { replaceLastSlash, toPosix } from './utils/paths.js';
import { unique } from './utils/unique.js';

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
  map[key] = value; // eslint-disable-line security/detect-object-injection
}

/**
 * Glob a pattern below each source root.
 *
 * @param {{directory: string}[]} roots - Source root records.
 * @param {string} pattern - Glob pattern relative to each root.
 * @param {object} [options={}] - Glob options.
 * @returns {string[]} Matching files.
 */
function globFromRoots(roots, pattern, options = {}) {
  return unique(
    roots
      .flatMap((root) =>
        globSync(toPosix(resolve(root.directory, pattern)), options),
      )
      .filter(Boolean),
  );
}

/**
 * Build ignored global paths for a global source root.
 *
 * @param {string} rootDir - Absolute global source root.
 * @returns {string[]} Ignore globs.
 */
function globalIgnorePatterns(rootDir) {
  return [
    toPosix(resolve(rootDir, 'components/**')),
    toPosix(resolve(rootDir, 'util/**')),
  ];
}

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
    // Gather *.js and *.scss from each declared variant root directory.
    const jsFiles = globFromRoots(
      structure.componentRootRecords,
      '**/!(*.stories|*.component|*.min|*.test).js',
    );
    const scssFiles = globFromRoots(
      structure.componentRootRecords,
      '**/!(_*|cl-*|sb-*).scss',
    );
    const storybookScss = globFromRoots(
      structure.componentRootRecords,
      '**/*{cl-*,sb-*}.scss',
    );

    // JS files emit under dist/js using the path below components when possible.
    for (const file of jsFiles) {
      add(compiledAssetOutputPath(file, 'js', structure, ctx), file);
    }

    // SCSS files emit under dist/css using the same relative path rules.
    for (const file of scssFiles) {
      add(compiledAssetOutputPath(file, 'css', structure, ctx), file);
    }

    // Storybook and component-library styles stay under dist/storybook.
    for (const file of storybookScss) {
      add(storybookStyleOutputPath(file, structure, ctx), file);
    }

    return inputs;
  }

  /* ------------------------------------------------------------------------ */
  /* MODERN BRANCH (existing behavior preserved)                              */
  /* ------------------------------------------------------------------------ */
  // Global JS
  for (const globalRoot of structure.globalRootRecords) {
    const files = globSync(
      toPosix(
        resolve(
          globalRoot.directory,
          '!(components|util)/**/!(*.stories|*.component|*.min|*.test).js',
        ),
      ),
      { ignore: globalIgnorePatterns(globalRoot.directory) },
    );
    for (const file of files) {
      add(compiledAssetOutputPath(file, 'js', structure, ctx), file);
    }
  }

  // Component JS
  for (const file of globFromRoots(
    structure.componentRootRecords,
    '**/!(*.stories|*.component|*.min|*.test).js',
  )) {
    add(compiledAssetOutputPath(file, 'js', structure, ctx), file);
  }

  // Global SCSS
  for (const globalRoot of structure.globalRootRecords) {
    const files = globSync(
      toPosix(
        resolve(
          globalRoot.directory,
          '!(components|util)/**/!(_*|cl-*|sb-*).scss',
        ),
      ),
      { ignore: globalIgnorePatterns(globalRoot.directory) },
    );
    for (const file of files) {
      add(compiledAssetOutputPath(file, 'css', structure, ctx), file);
    }
  }

  // Component SCSS
  for (const file of globFromRoots(
    structure.componentRootRecords,
    '**/!(_*|cl-*|sb-*).scss',
  )) {
    add(compiledAssetOutputPath(file, 'css', structure, ctx), file);
  }

  // Storybook/CL SCSS
  for (const file of globFromRoots(
    structure.sourceRootRecords,
    '**/*{cl-*,sb-*}.scss',
  )) {
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
