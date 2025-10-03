/**
 * @file Entries map builder for Vite/Rollup.
 *
 * Builds a keyed input map (for `build.rollupOptions.input`) where the map key
 * encodes the final folder inside the Vite outDir (default `dist/`).
 *
 * Modern projects:
 *   - Global/base assets → "global/..."
 *   - Component assets   → "components/..." (or mirrored to ./components when Drupal)
 *   - SDC=true removes the injected "/css" or "/js" bucket
 *
 * Component Structure Overrides projects (project.emulsify.json: variant.structureImplementations):
 *   - **Only** compile JS/SCSS.
 *   - JS  → "js/<relative-without-ext>"
 *   - CSS → "css/<relative-without-ext>"
 *   - No Twig/assets copying here (handled in plugins and disabled for Component Structure Overrides).
 *   - cl-* / sb-* SCSS → "storybook/<path-without-ext>"
 */

import fs from 'fs';
import { resolve, sep } from 'path';
import { globSync } from 'glob';

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
    ? resolve(
        srcDir,
        '!(components|util)/**/!(*.stories|*.component|*.min|*.test).js',
      )
    : '';
  const ComponentJsPattern = srcExists
    ? resolve(srcDir, 'components/**/!(*.stories|*.component|*.min|*.test).js')
    : resolve(srcDir, '**/!(*.stories|*.component|*.min|*.test).js');

  // Icons (not used here but preserved for parity)
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
 * Relativize path from base directory (POSIX).
 * @param {string} abs
 * @param {string} base
 */
function relFrom(abs, base) {
  const posixAbs = toPosix(abs);
  const posixBase = toPosix(base).replace(/\/$/, '');
  const needle = `${posixBase}/`;
  return posixAbs.startsWith(needle) ? posixAbs.slice(needle.length) : posixAbs;
}

/** Insert "/css|js" bucket unless SDC=true; strip extension. */
function injectBucket(rel, bucket, SDC) {
  const withoutExt = rel.replace(/\.(scss|js)$/i, '');
  if (SDC) {
    // When SDC=true we avoid a bucket folder. Add a suffix for CSS to avoid collisions with JS.
    return bucket === 'css' ? `${withoutExt}__style` : withoutExt;
  }
  return replaceLastSlash(rel, `/${bucket}/`).replace(/\.(scss|js)$/i, '');
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
  const {
    projectDir,
    srcDir,
    SDC,
    structureOverrides,
    structureRoots = [],
  } = ctx;

  /** @type {Record<string, string>} */
  const inputs = {};

  /**
   * Add a key/file pair into the inputs map safely (sanitized + POSIX).
   * @param {string} key
   * @param {string} abs
   */
  const add = (key, abs) => {
    const clean = sanitizePath(toPosix(key)).replace(/^\/+/, '');
    if (!clean) return;
    safeSetKey(inputs, clean, abs);
  };

  /* ------------------------------------------------------------------------ */
  /* STRUCTURE OVERRIDES BRANCH                                               */
  /* ------------------------------------------------------------------------ */
  if (structureOverrides && structureRoots.length) {
    // Gather *.js and *.scss from each declared variant root directory.
    const jsFiles = [];
    const scssFiles = [];
    const storybookScss = [];

    for (const rootAbs of structureRoots) {
      const jsGlob = resolve(
        rootAbs,
        '**/!(*.stories|*.component|*.min|*.test).js',
      );
      const scssGlob = resolve(rootAbs, '**/!(_*|cl-*|sb-*).scss');
      const clSbGlob = resolve(rootAbs, '**/*{cl-*,sb-*}.scss');

      jsFiles.push(...globSync(toPosix(jsGlob)));
      scssFiles.push(...globSync(toPosix(scssGlob)));
      storybookScss.push(...globSync(toPosix(clSbGlob)));
    }

    // JS → dist/js/<relative-from-components-without-ext>
    for (const file of jsFiles) {
      // Compute path relative to the top-level `components/` folder if present,
      // else relative to the project root as a fallback.
      const relFromProj = relFrom(file, projectDir);
      const relFromComponents = relFromProj.includes('components/')
        ? relFromProj.split('components/')[1]
        : relFromProj;

      const outKey = `js/${relFromComponents.replace(/\.js$/i, '')}`;
      add(outKey, file);
    }

    // CSS → dist/css/<relative-from-components-without-ext>
    for (const file of scssFiles) {
      const relFromProj = relFrom(file, projectDir);
      const relFromComponents = relFromProj.includes('components/')
        ? relFromProj.split('components/')[1]
        : relFromProj;

      const outKey = `css/${relFromComponents.replace(/\.scss$/i, '')}`;
      add(outKey, file);
    }

    // Storybook/CL styles → dist/storybook/<relative-without-ext>
    for (const file of storybookScss) {
      const relFromProj = relFrom(file, projectDir).replace(/\.scss$/i, '');
      const outKey = `storybook/${relFromProj}`;
      add(outKey, file);
    }

    return inputs;
  }

  /* ------------------------------------------------------------------------ */
  /* MODERN BRANCH (existing behavior preserved)                              */
  /* ------------------------------------------------------------------------ */
  const {
    BaseJsPattern,
    ComponentJsPattern,
    BaseScssPattern,
    ComponentScssPattern,
    ComponentLibraryScssPattern,
  } = patterns;

  const componentRoot = 'components'; // keys are under "components/..." (plugins may mirror)

  // Global JS
  if (BaseJsPattern) {
    for (const file of globSync(toPosix(BaseJsPattern))) {
      const rel = relFrom(file, srcDir);
      const key = `global/${injectBucket(rel, 'js', SDC)}`;
      add(key, file);
    }
  }

  // Component JS
  for (const file of globSync(toPosix(ComponentJsPattern))) {
    const posix = toPosix(file);
    const idx = posix.indexOf('/components/');
    const after =
      idx !== -1
        ? posix.slice(idx + '/components/'.length)
        : relFrom(file, srcDir);
    const key = `${componentRoot}/${injectBucket(`components/${after}`, 'js', SDC).replace(/^components\//, '')}`;
    add(key, file);
  }

  // Global SCSS
  if (BaseScssPattern) {
    for (const file of globSync(toPosix(BaseScssPattern))) {
      const rel = relFrom(file, srcDir);
      const key = `global/${injectBucket(rel, 'css', SDC)}`;
      add(key, file);
    }
  }

  // Component SCSS
  for (const file of globSync(toPosix(ComponentScssPattern))) {
    const posix = toPosix(file);
    const idx = posix.indexOf('/components/');
    const after =
      idx !== -1
        ? posix.slice(idx + '/components/'.length)
        : relFrom(file, srcDir);
    const key = `${componentRoot}/${injectBucket(`components/${after}`, 'css', SDC).replace(/^components\//, '')}`;
    add(key, file);
  }

  // Storybook/CL SCSS
  for (const file of globSync(toPosix(ComponentLibraryScssPattern))) {
    const rel = relFrom(file, srcDir).replace(/\.scss$/i, '');
    add(`storybook/${rel}`, file);
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
