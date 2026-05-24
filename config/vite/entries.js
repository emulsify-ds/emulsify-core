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
import { resolve, sep } from 'path';
import { globSync } from 'glob';
import {
  compiledAssetOutputPath,
  resolveProjectStructure,
  storybookStyleOutputPath,
} from './project-structure.js';

/** Normalize filesystem paths to POSIX for Rollup keys. */
export const toPosix = (p) => p.split(sep).join('/');

/** Remove characters that would confuse Rollup naming or file systems. */
export const sanitizePath = (s) => s.replace(/[^a-zA-Z0-9/_-]/g, '');

/** Replace last slash with an injected subdir (e.g., '/css/' or '/js/'). */
export function replaceLastSlash(str, replacement) {
  const i = str.lastIndexOf('/');
  if (i === -1) return str;
  return str.slice(0, i) + replacement + str.slice(i + 1);
}

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
/* Patterns                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Create all glob patterns for modern (non-legacy) flow.
 * @param {BuildContext} ctx
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

  // SCSS patterns separate global styles, component styles, and Storybook styles.
  const BaseScssPattern = srcExists
    ? resolve(srcDir, '!(components|util)/**/!(_*|cl-*|sb-*).scss')
    : '';
  const ComponentScssPattern = srcExists
    ? resolve(srcDir, 'components/**/!(_*|cl-*|sb-*).scss')
    : resolve(srcDir, '**/!(_*|cl-*|sb-*).scss');
  const ComponentLibraryScssPattern = resolve(srcDir, '**/*{cl-*,sb-*}.scss');

  // JS patterns exclude stories, component metadata, minified files, and tests.
  const BaseJsPattern = srcExists
    ? resolve(
        srcDir,
        '!(components|util)/**/!(*.stories|*.component|*.min|*.test).js',
      )
    : '';
  const ComponentJsPattern = srcExists
    ? resolve(srcDir, 'components/**/!(*.stories|*.component|*.min|*.test).js')
    : resolve(srcDir, '**/!(*.stories|*.component|*.min|*.test).js');

  // Preserve the icon pattern for compatibility with older consumers.
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
 * Return unique file paths while preserving first-seen order.
 *
 * @param {string[]} files - File paths.
 * @returns {string[]} Unique file paths.
 */
function uniqueFiles(files) {
  return Array.from(new Set(files.filter(Boolean)));
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
  return uniqueFiles(
    roots.flatMap((root) =>
      globSync(toPosix(resolve(root.directory, pattern)), options),
    ),
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
 * @param {ReturnType<makePatterns>} patterns
 * @returns {Record<string, string>}
 */
export function buildInputs(ctx, patterns) {
  void patterns;
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
  const patterns = makePatterns(ctx);
  return buildInputs(ctx, patterns);
}
