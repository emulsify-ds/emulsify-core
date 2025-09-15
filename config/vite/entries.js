/**
 * @file Entries map builder for Vite/Rollup.
 * @description
 * Produces a **keyed input map** where each key becomes Rollup’s `[name]`
 * (i.e., the output path stem relative to the build `outDir`), and each
 * value is an absolute file path to compile.
 *
 * Conventions used here:
 * - **Global/base assets** → keys start with `"global/..."` (Vite writes to `dist/global/...`)
 * - **Component assets** → keys start with `"components/..."` (Vite writes to `dist/components/...`;
 *   if your mirror plugin is enabled, these are then copied to `./components/...`)
 * - **Storybook/CL assets** → keys start with `"storybook/..."`
 * - **SDC mode** (`SDC === true`) removes the `/css` or `/js` bucket level.
 *   To avoid JS/CSS name collisions in that mode, CSS keys receive a temporary
 *   `__style` suffix that should be stripped in `assetFileNames` (see vite.config.js).
 */

import fs from 'fs';
import { resolve, sep } from 'path';
import { globSync } from 'glob';

/**
 * Temporary suffix added to CSS entry keys when `SDC === true` to avoid
 * collisions with same-stem JS entries (e.g., `button` vs `button.css`).
 * Your Vite `assetFileNames` should strip this suffix for final filenames.
 * @type {string}
 */
const CSS_SUFFIX = '__style';

/**
 * Normalize a filesystem path to POSIX separators (`/`).
 * @param {string} filePath - Platform-specific file path.
 * @returns {string} POSIX-normalized path.
 */
export const toPosix = (filePath) => filePath.split(sep).join('/');

/**
 * Sanitize a path segment for use as a Rollup name (strip unsafe chars).
 * @param {string} pathSegment - A path-like string.
 * @returns {string} Sanitized path segment.
 */
export const sanitizePath = (pathSegment) =>
  pathSegment.replace(/[^a-zA-Z0-9/_-]/g, '');

/**
 * Replace the last slash in a POSIX path with a given subpath (e.g. `/css/` or `/js/`).
 * @param {string} posixPath - Path using POSIX separators.
 * @param {string} replacement - Subpath to inject (e.g., `/css/`).
 * @returns {string} Modified POSIX path.
 */
export function replaceLastSlash(posixPath, replacement) {
  const idx = posixPath.lastIndexOf('/');
  if (idx === -1) return posixPath;
  return posixPath.slice(0, idx) + replacement + posixPath.slice(idx + 1);
}

/**
 * @typedef {Object} BuildContext
 * @property {string} projectDir  - Absolute project root directory.
 * @property {string} srcDir      - Absolute path to the repository's source root.
 * @property {boolean} srcExists  - Whether `src/` exists (vs. legacy `components/` root).
 * @property {boolean} isDrupal   - Whether we’re targeting Drupal behavior.
 * @property {boolean} SDC        - Single-Directory Components mode toggle.
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
 * Build all glob patterns needed to discover inputs.
 * @param {BuildContext} ctx - Build context.
 * @returns {PatternSet} Set of glob patterns.
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

  // Icons (not used directly in the inputs map but kept for parity with older toolchains)
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
 *
 * Keys encode the **final folder layout** relative to the build `outDir`
 * (usually `dist/`). Values are absolute input file paths.
 *
 * Example keys:
 * - `global/layout/css/header`      → emits `dist/global/layout/css/header.css`
 * - `components/button/button`      → emits `dist/components/button/button.js`
 * - `components/button/button__style` (SDC) → emits `dist/components/button/button.css`
 *
 * @param {BuildContext} ctx - Build context (paths & flags).
 * @param {PatternSet} patterns - Glob patterns from {@link makePatterns}.
 * @returns {Record<string, string>} Map of `{ [name]: absolutePath }` for Rollup.
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

  /** @type {Record<string, string>} */
  const inputsMap = {};

  /** POSIX version of srcDir for stable slicing. */
  const srcDirPosix = toPosix(srcDir);

  /**
   * Add an entry to the inputs map if the key is new and sane.
   * @param {string} keyStem - Output path stem (used as `[name]`).
   * @param {string} absolutePath - Absolute input file path.
   */
  const addInputEntry = (keyStem, absolutePath) => {
    const normalizedKey = sanitizePath(toPosix(keyStem).replace(/^\/+/, ''));
    if (!normalizedKey) return;
    if (!Object.prototype.hasOwnProperty.call(inputsMap, normalizedKey)) {
      inputsMap[normalizedKey] = absolutePath;
    }
  };

  /**
   * Compute path relative to `srcDir` (POSIX).
   * @param {string} absolutePath - Absolute path to a file.
   * @returns {string} Relative POSIX path under `srcDir`.
   */
  const relativePathFromSrc = (absolutePath) => {
    const absPosix = toPosix(absolutePath);
    const needle = `${srcDirPosix}/`;
    return absPosix.startsWith(needle)
      ? absPosix.slice(needle.length)
      : absPosix;
  };

  /**
   * Derive the output stem (i.e., Rollup `[name]`) for a given source path.
   * - If `SDC === true`, we **omit** `/css` or `/js` and add `__style` for CSS only.
   * - If `SDC === false`, we **insert** `/css` or `/js` right before the filename.
   *
   * @param {string} relativePath - POSIX relative path including extension.
   * @param {'css'|'js'} bucket - Target bucket.
   * @param {boolean} sdc - Single-Directory Components flag.
   * @returns {string} Output stem without extension.
   */
  const computeOutputStem = (relativePath, bucket, sdc) => {
    // Input forms:
    //   "components/accordion/accordion.scss"  or  "layout/header.js"
    const withoutExt = relativePath.replace(/\.(scss|js)$/i, '');
    if (sdc) {
      // No /css or /js; add a suffix **only** for CSS to avoid collisions.
      return bucket === 'css' ? `${withoutExt}${CSS_SUFFIX}` : withoutExt;
    }
    // Insert /css or /js before the filename directory.
    return replaceLastSlash(relativePath, `/${bucket}/`).replace(
      /\.(scss|js)$/i,
      '',
    );
  };

  /* ----------------------------- Base / Global JS ----------------------------- */
  if (BaseJsPattern) {
    for (const absolutePath of globSync(toPosix(BaseJsPattern))) {
      const rel = relativePathFromSrc(absolutePath);
      const keyStem = `global/${computeOutputStem(rel, 'js', SDC)}`;
      addInputEntry(keyStem, absolutePath);
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
    const keyStem = `components/${stem}`;
    addInputEntry(keyStem, absolutePath);
  }

  /* --------------------------- Base / Global SCSS ---------------------------- */
  if (BaseScssPattern) {
    for (const absolutePath of globSync(toPosix(BaseScssPattern))) {
      const rel = relativePathFromSrc(absolutePath);
      const keyStem = `global/${computeOutputStem(rel, 'css', SDC)}`;
      addInputEntry(keyStem, absolutePath);
    }
  }

  /* --------------------------- Component SCSS -------------------------------- */
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
    const keyStem = `components/${stem}`;
    addInputEntry(keyStem, absolutePath);
  }

  /* ---------------- Component Library (Storybook / CL) ----------------------- */
  for (const absolutePath of globSync(toPosix(ComponentLibraryScssPattern))) {
    const rel = relativePathFromSrc(absolutePath).replace(/\.scss$/i, '');
    addInputEntry(`storybook/${rel}`, absolutePath);
  }

  return inputsMap;
}

/**
 * Convenience wrapper for building inputs from just a `projectDir`.
 *
 * Resolves `srcDir`, detects whether `src/` exists, and forwards the flags
 * to {@link buildInputs}.
 *
 * @param {string} projectDir - Absolute path to the project root.
 * @param {boolean} [isDrupal=false] - Whether to enable Drupal-related behavior.
 * @param {boolean} [SDC=false] - Single-Directory Components mode toggle.
 * @returns {Record<string, string>} Inputs map suitable for `rollupOptions.input`.
 */
export function buildInputsFromProject(
  projectDir,
  isDrupal = false,
  SDC = false,
) {
  const srcPath = resolve(projectDir, 'src');
  const srcExists = fs.existsSync(srcPath);
  const srcDir = srcExists ? srcPath : resolve(projectDir, 'components');

  const ctx = { projectDir, srcDir, srcExists, isDrupal, SDC };
  const patterns = makePatterns(ctx);
  return buildInputs(ctx, patterns);
}
