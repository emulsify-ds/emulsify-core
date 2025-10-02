/**
 * @file Entries map builder for Vite/Rollup.
 *
 * @summary
 * Creates a **keyed input map** for Rollup/Vite where each key becomes the
 * output stem (`[name]`) relative to your build `outDir`, and each value is an
 * absolute path to the source file. Keys intentionally encode the final folder
 * so your `vite.config.js` can write files exactly where Emulsify expects:
 *
 * - Global/base assets   → keys start with `"global/..."`   → dist/global/...
 * - Component assets     → keys start with `"components/..."` → dist/components/...
 * - Storybook/CL assets  → keys start with `"storybook/..."` → dist/storybook/...
 *
 * The **SDC** switch (Single Directory Components) controls whether we insert
 * a `/css` or `/js` folder in the generated keys:
 * - When `SDC === true`, we **do not** insert the type folder. To avoid JS/CSS
 *   name collisions, we add a temporary `__style` suffix to CSS keys. You must
 *   strip this suffix in `assetFileNames` (see vite.config.js).
 * - When `SDC === false`, we mimic the old Webpack layout by inserting a
 *   `/css` or `/js` folder just before the filename.
 *
 * This module does **not** decide whether components end up under `dist/` or
 * the project-level `./components/`. That responsibility belongs to the build
 * plugins (e.g. a mirroring plugin for Drupal projects).
 */

import { resolve, sep } from 'path';
import { globSync } from 'glob';

/* ==========================================================================
 * Tiny utilities
 * ======================================================================== */

/**
 * Convert a platform path to POSIX form (forward slashes).
 * @param {string} p
 * @returns {string}
 */
export const toPosix = (p) => p.split(sep).join('/');

/**
 * Remove characters that could confuse file systems or Rollup naming.
 * @param {string} s
 * @returns {string}
 */
export const sanitizePath = (s) => String(s).replace(/[^a-zA-Z0-9/_-]/g, '');

/**
 * Replace the last slash in a path-like string with a replacement.
 * Useful for injecting `/css/` or `/js/` just before the filename.
 * @param {string} str
 * @param {string} replacement
 * @returns {string}
 */
export function replaceLastSlash(str, replacement) {
  const i = str.lastIndexOf('/');
  if (i === -1) return str;
  return str.slice(0, i) + replacement + str.slice(i + 1);
}

/* ==========================================================================
 * Types
 * ======================================================================== */

/**
 * @typedef {Object} BuildContext
 * @property {string} projectDir Absolute path to the project root.
 * @property {string} srcDir     Absolute path to the canonical source dir.
 * @property {boolean} srcExists Whether a `src/` directory exists.
 * @property {boolean} SDC       Single Directory Components mode.
 */

/**
 * @typedef {Object} Patterns
 * @property {string} BaseScssPattern
 * @property {string} ComponentScssPattern
 * @property {string} ComponentLibraryScssPattern
 * @property {string} BaseJsPattern
 * @property {string} ComponentJsPattern
 * @property {string} SpritePattern
 */

/* ==========================================================================
 * Pattern builder
 * ======================================================================== */

/**
 * Build all glob patterns based on the environment.
 * @param {BuildContext} ctx
 * @returns {Patterns}
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

  // Icons (not used here; preserved for consumers)
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

/* ==========================================================================
 * Input map builder
 * ======================================================================== */

/**
 * Compute the "output stem" (key without extension) for a given **relative**
 * source path and asset type.
 *
 * @param {string} rel A path relative to `srcDir` (POSIX).
 * @param {'js'|'css'} type Asset type.
 * @param {boolean} SDC Single Directory Components mode.
 * @returns {string} The computed key segment (no extension).
 */
function computeOutputStem(rel, type, SDC) {
  // Drop the original extension first.
  const withoutExt = rel.replace(/\.(scss|js)$/i, '');

  if (SDC) {
    // SDC mode: keep the directory structure as-is.
    // Add a temporary suffix for CSS to avoid collisions with JS of same name.
    return type === 'css' ? `${withoutExt}__style` : withoutExt;
  }

  // Non-SDC: inject `/css/` or `/js/` just before the filename.
  return replaceLastSlash(rel, `/${type}/`).replace(/\.(scss|js)$/i, '');
}

/**
 * Build the complete Rollup/Vite **input map**.
 * Keys are **relative to `outDir`** (e.g., `"global/layout/header"`), and values
 * are the absolute file paths to compile.
 *
 * @param {BuildContext} ctx
 * @param {Patterns} patterns
 * @returns {Record<string, string>} An object suitable for `rollupOptions.input`.
 */
export function buildInputs(ctx, patterns) {
  const { srcDir, SDC } = ctx;
  const {
    BaseJsPattern,
    ComponentJsPattern,
    BaseScssPattern,
    ComponentScssPattern,
    ComponentLibraryScssPattern,
  } = patterns;

  // Use a Map to avoid the "Generic Object Injection Sink" lint warning and to
  // keep insertion order deterministic.
  /** @type {Map<string, string>} */
  const inputMap = new Map();

  const SRC_POSIX = toPosix(srcDir);

  /**
   * Safely add one entry to the map after sanitizing the key.
   * If a key already exists, the first one wins (deterministic).
   * @param {string} key
   * @param {string} absPath
   */
  const add = (key, absPath) => {
    const clean = sanitizePath(toPosix(key).replace(/^\/+/, ''));
    if (!clean || inputMap.has(clean)) return;
    inputMap.set(clean, absPath);
  };

  /**
   * Get a POSIX relative path from `srcDir` to an absolute file.
   * @param {string} abs
   * @returns {string}
   */
  const relativePathFromSrc = (abs) => {
    const posix = toPosix(abs);
    const needle = `${toPosix(SRC_POSIX)}/`;
    return posix.startsWith(needle) ? posix.slice(needle.length) : posix;
  };

  /* ----------------------------- Base / Global JS ----------------------------- */
  if (BaseJsPattern) {
    for (const absolutePath of globSync(toPosix(BaseJsPattern))) {
      const rel = relativePathFromSrc(absolutePath); // e.g., "layout/header.js"
      const stem = computeOutputStem(rel, 'js', SDC);
      add(`global/${stem}`, absolutePath);
    }
  }

  /* ----------------------------- Component JS -------------------------------- */
  for (const absolutePath of globSync(toPosix(ComponentJsPattern))) {
    const filePosix = toPosix(absolutePath);
    const markerIdx = filePosix.indexOf('/components/');
    const afterComponents =
      markerIdx !== -1
        ? filePosix.slice(markerIdx + '/components/'.length)
        : relativePathFromSrc(absolutePath);

    // Build from a "components/<rest>" shape then drop the prefixed folder from the stem.
    const stem = computeOutputStem(
      `components/${afterComponents}`,
      'js',
      SDC,
    ).replace(/^components\//, '');
    add(`components/${stem}`, absolutePath);
  }

  /* --------------------------- Base / Global SCSS ----------------------------- */
  if (BaseScssPattern) {
    for (const absolutePath of globSync(toPosix(BaseScssPattern))) {
      const rel = relativePathFromSrc(absolutePath); // e.g., "layout/layout.scss"
      const stem = computeOutputStem(rel, 'css', SDC);
      add(`global/${stem}`, absolutePath);
    }
  }

  /* --------------------------- Component SCSS --------------------------------- */
  for (const absolutePath of globSync(toPosix(ComponentScssPattern))) {
    const filePosix = toPosix(absolutePath);
    const markerIdx = filePosix.indexOf('/components/');
    const afterComponents =
      markerIdx !== -1
        ? filePosix.slice(markerIdx + '/components/'.length)
        : relativePathFromSrc(absolutePath);

    const stem = computeOutputStem(
      `components/${afterComponents}`,
      'css',
      SDC,
    ).replace(/^components\//, '');
    add(`components/${stem}`, absolutePath);
  }

  /* --------------------- Component Library (Storybook / CL) ------------------- */
  for (const absolutePath of globSync(toPosix(ComponentLibraryScssPattern))) {
    const rel = relativePathFromSrc(absolutePath).replace(/\.scss$/i, '');
    add(`storybook/${rel}`, absolutePath);
  }

  // Convert to a plain object for Vite/Rollup.
  return Object.fromEntries(inputMap.entries());
}

/* ==========================================================================
 * (Optional) Deprecated convenience wrapper
 * ======================================================================== */

/**
 * @deprecated Prefer resolving your environment once (e.g., via `resolveEnvironment()`)
 * and then call `makePatterns(env)` and `buildInputs(env, patterns)` directly.
 * This wrapper is kept for backwards compatibility but avoids filesystem probing
 * that triggers security linters.
 *
 * @param {string} projectDir Absolute path to the project root.
 * @param {boolean} [SDC=false] Whether to use SDC (no /css|/js buckets).
 * @returns {Record<string, string>}
 */
export function buildInputsFromProject(projectDir, SDC = false) {
  // Assume the canonical layout and let callers pass a proper env if different.
  const srcDir = resolve(projectDir, 'src');
  const ctx = { projectDir, srcDir, srcExists: true, SDC };
  const patterns = makePatterns(ctx);
  return buildInputs(ctx, patterns);
}
