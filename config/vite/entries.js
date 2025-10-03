/**
 * @file Entries map builder for Vite/Rollup.
 *
 * Builds a keyed input map (for `build.rollupOptions.input`) where the map key
 * encodes the final folder inside the Vite outDir (default `dist/`).
 *
 * Modern projects:
 *   - Global/base assets → "global/..."
 *   - Component assets   → "components/..." (or mirrored to ./components when Drupal+SDC)
 *   - SDC=true removes the injected "/css" or "/js" bucket
 *
 * Legacy variant projects (project.emulsify.json: variant.structureImplementations):
 *   - **Only** compile JS/SCSS.
 *   - JS  → "js/<relative-without-ext>"
 *   - CSS → "css/<relative-without-ext>"
 *   - No Twig/assets copying here (handled in plugins and disabled for legacy variant).
 *   - cl-* / sb-* SCSS → "storybook/<path-without-ext>"
 */

import fs from 'fs';
import { resolve, sep, relative, dirname } from 'path';
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
 * @property {boolean} legacyVariant
 * @property {string[]} [variantRoots]
 */

/**
 * Create all glob patterns for modern (non-legacy) flow.
 * @param {BuildContext} ctx
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

  // Icons (preserved for other tooling)
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
 * Build input map (modern + legacy branches).
 *
 * @param {BuildContext} ctx
 * @param {ReturnType<makePatterns>} patterns
 * @returns {Record<string, string>}
 */
export function buildInputs(ctx, patterns) {
  const {
    projectDir,
    srcDir,
    srcExists,
    isDrupal,
    SDC,
    legacyVariant,
    variantRoots = [],
  } = ctx;

  /** @type {Record<string, string>} */
  const inputs = {};
  const SRC_POSIX = toPosix(srcDir);
  const PROJ_POSIX = toPosix(projectDir);

  /**
   * Add a key/file pair into the inputs map safely.
   * (Avoids generic object injection by checking hasOwnProperty on our own object.)
   */
  const add = (key, abs) => {
    const k = sanitizePath(toPosix(key).replace(/^\/+/, ''));
    if (!k) return;
    if (Object.prototype.hasOwnProperty.call(inputs, k)) return; // ensure no overwrite
    inputs[k] = abs;
  };

  const relFrom = (abs, baseAbs) => {
    const posixAbs = toPosix(abs);
    const posixBase = toPosix(baseAbs).replace(/\/$/, '');
    const needle = `${posixBase}/`;
    return posixAbs.startsWith(needle)
      ? posixAbs.slice(needle.length)
      : posixAbs;
  };

  const insertBucket = (rel, bucket, sdc) => {
    // rel like "components/accordion/accordion.scss" or "layout/layout.js"
    const withoutExt = rel.replace(/\.(scss|js)$/i, '');
    if (sdc) {
      // No /css|/js bucket; (we used __style suffix in some configs to avoid collisions)
      return bucket === 'css' ? `${withoutExt}__style` : withoutExt;
    }
    return replaceLastSlash(rel, `/${bucket}/`).replace(/\.(scss|js)$/i, '');
  };

  const useComponentRoot =
    srcExists && isDrupal ? 'components' : 'dist/components';

  /* ------------------------------------------------------------------------ */
  /* LEGACY VARIANT BRANCH                                                    */
  /* ------------------------------------------------------------------------ */
  if (legacyVariant && variantRoots.length) {
    // Gather *.js and *.scss from each declared variant root directory.
    const jsFiles = [];
    const scssFiles = [];
    const storybookScss = [];

    for (const rootAbs of variantRoots) {
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

  // --- Non-component/global JS ---
  if (BaseJsPattern) {
    for (const file of globSync(toPosix(BaseJsPattern))) {
      const rel = relFrom(file, srcDir);
      const key = `global/${insertBucket(rel, 'js', SDC)}`;
      add(key, file);
    }
  }

  // --- Component JS ---
  for (const file of globSync(toPosix(ComponentJsPattern))) {
    const posix = toPosix(file);
    const idx = posix.indexOf('/components/');
    const after =
      idx !== -1
        ? posix.slice(idx + '/components/'.length)
        : relFrom(file, srcDir);
    const key = `components/${insertBucket(`components/${after}`, 'js', SDC).replace(/^components\//, '')}`;
    add(key, file);
  }

  // --- Non-component/global SCSS ---
  if (BaseScssPattern) {
    for (const file of globSync(toPosix(BaseScssPattern))) {
      const rel = relFrom(file, srcDir);
      const key = `global/${insertBucket(rel, 'css', SDC)}`;
      add(key, file);
    }
  }

  // --- Component SCSS ---
  for (const file of globSync(toPosix(ComponentScssPattern))) {
    const posix = toPosix(file);
    const idx = posix.indexOf('/components/');
    const after =
      idx !== -1
        ? posix.slice(idx + '/components/'.length)
        : relFrom(file, srcDir);
    const key = `components/${insertBucket(`components/${after}`, 'css', SDC).replace(/^components\//, '')}`;
    add(key, file);
  }

  // --- Component Library (Storybook/CL) SCSS ---
  for (const file of globSync(toPosix(ComponentLibraryScssPattern))) {
    const rel = relFrom(file, srcDir).replace(/\.scss$/i, '');
    add(`storybook/${rel}`, file);
  }

  return inputs;
}

/**
 * Convenience wrapper for ad-hoc usage.
 * @param {string} projectDir
 * @param {boolean} isDrupal
 * @param {boolean} SDC
 * @param {boolean} legacyVariant
 * @param {string[]} [variantRoots]
 */
export function buildInputsFromProject(
  projectDir,
  isDrupal = false,
  SDC = false,
  legacyVariant = false,
  variantRoots = [],
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
    legacyVariant,
    variantRoots,
  };
  const patterns = makePatterns(ctx);
  return buildInputs(ctx, patterns);
}
