/* eslint-disable */

/**
 * @file Entries map builder for Vite/Rollup.
 * @description Builds a keyed input map where each key encodes its final folder:
 *   - Global/base assets → "dist/..." (always)
 *   - Component assets → "components/..." if (srcExists && isDrupal), else "dist/components/..."
 *   - SDC=true removes the "/css" or "/js" bucket level
 */

import fs from 'fs';
import { resolve, sep } from 'path';
import { globSync } from 'glob';

/** POSIX normalize for keys */
export const toPosix = (p) => p.split(sep).join('/');

/** Sanitize keys */
export const sanitizePath = (s) => s.replace(/[^a-zA-Z0-9/_-]/g, '');

/** Replace last slash with injected subdir (e.g. '/css/' or '/js/') */
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
 * @property {boolean} isDrupal
 * @property {boolean} SDC
 */

/** Build all glob patterns */
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

  // Icons (not used in inputs map but preserved)
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
 * Build keyed input map.
 * Keys encode their full path relative to project root (no extension):
 *   - dist/global/... or dist/components/... or components/...
 */
export function buildInputs(ctx, patterns) {
  const { projectDir, srcDir, srcExists, isDrupal, SDC } = ctx;
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

  const add = (key, abs) => {
    const k = sanitizePath(toPosix(key).replace(/^\/+/, ''));
    if (k && !Object.prototype.hasOwnProperty.call(inputs, k)) inputs[k] = abs;
  };

  const relFromSrc = (abs) => {
    const posix = toPosix(abs);
    const needle = `${SRC_POSIX}/`;
    return posix.startsWith(needle) ? posix.slice(needle.length) : posix;
  };

  /** Given rel path and desired bucket ('css'|'js'), insert bucket unless SDC */
  const insertBucket = (rel, bucket, SDC) => {
    // rel is like "components/accordion/accordion.scss" or "layout/layout.js"
    const withoutExt = rel.replace(/\.(scss|js)$/i, '');
    if (SDC) {
      // No /css or /js subfolder; add suffix ONLY for CSS to avoid key collision
      return bucket === 'css' ? `${withoutExt}__style` : withoutExt;
    }
    // SDC=false: keep /css|/js bucket
    return replaceLastSlash(rel, `/${bucket}/`).replace(/\.(scss|js)$/i, '');
  };

  /** Component root (may be outside dist) */
  const componentRoot = (srcExists && isDrupal) ? 'components' : 'dist/components';

  /* ----------------------------- Base / Global JS ----------------------------- */
  if (BaseJsPattern) {
    for (const file of globSync(toPosix(BaseJsPattern))) {
      const rel = relFromSrc(file);
      const key = `global/${insertBucket(rel, 'js', SDC)}`;
      add(key, file);
    }
  }

  /* ----------------------------- Component JS -------------------------------- */
  for (const file of globSync(toPosix(ComponentJsPattern))) {
    const posix = toPosix(file);
    const idx = posix.indexOf('/components/');
    const after = idx !== -1 ? posix.slice(idx + '/components/'.length) : relFromSrc(file);
    const key = `components/${insertBucket(`components/${after}`, 'js', SDC).replace(/^components\//, '')}`;
    add(key, file);
  }

  /* --------------------------- Base / Global SCSS ---------------------------- */
  if (BaseScssPattern) {
    for (const file of globSync(toPosix(BaseScssPattern))) {
      const rel = relFromSrc(file);
      const key = `global/${insertBucket(rel, 'css', SDC)}`;
      add(key, file);
    }
  }

  /* --------------------------- Component SCSS -------------------------------- */
  for (const file of globSync(toPosix(ComponentScssPattern))) {
    const posix = toPosix(file);
    const idx = posix.indexOf('/components/');
    const after = idx !== -1 ? posix.slice(idx + '/components/'.length) : relFromSrc(file);
    const key = `components/${insertBucket(`components/${after}`, 'css', SDC).replace(/^components\//, '')}`;
    add(key, file);
  }

  /* ----------- Component Library (Storybook/CL) ----------- */
  for (const file of globSync(toPosix(ComponentLibraryScssPattern))) {
    const rel = relFromSrc(file).replace(/\.scss$/i, '');
    add(`storybook/${rel}`, file);
  }

  return inputs;
}

/** Convenience wrapper */
export function buildInputsFromProject(projectDir, isDrupal = false, SDC = false) {
  const srcPath = resolve(projectDir, 'src');
  const srcExists = fs.existsSync(srcPath);
  const srcDir = srcExists ? srcPath : resolve(projectDir, 'components');

  const ctx = { projectDir, srcDir, srcExists, isDrupal, SDC };
  const patterns = makePatterns(ctx);
  return buildInputs(ctx, patterns);
}
