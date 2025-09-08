/**
 * @fileoverview Build Webpack entries and export the configuration.
 * - Discovers JS/SCSS assets (base + component) via glob patterns
 * - Shapes output paths based on platform and SDC (singleDirectoryComponents)
 * - Wires up loaders, plugins, and optimizations
 */

import { posix as path } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sync as globSync } from 'glob';
import fs from 'fs-extra';

import loaders from './loaders.js';
import plugins from './plugins.js';
import resolves from './resolves.js';
import optimizers from './optimizers.js';
import emulsifyConfig from '../../../../../project.emulsify.json' with { type: 'json' };

/** @type {string} */
const __filename = fileURLToPath(import.meta.url);
/** @type {string} */
const __dirname = path.dirname(__filename);

/** @type {string} Absolute project root (five levels up from this file). */
const projectDir = path.resolve(__dirname, '../../../../..');

/** @type {boolean} True when a "src/" directory exists (WP layout). */
const hasSrc = fs.pathExistsSync(path.resolve(projectDir, 'src'));

/** @type {string} The canonical source directory ("src" if present, else "components"). */
const srcDir = hasSrc
  ? path.resolve(projectDir, 'src')
  : path.resolve(projectDir, 'components');

/** @type {boolean} True when platform is Drupal (affects component output root). */
const isDrupal = emulsifyConfig?.project?.platform === 'drupal';

/** @type {boolean} Respect SDC (single-directory-components) layout if explicitly true. */
const SDC = Boolean(emulsifyConfig?.project?.singleDirectoryComponents);

/** @type {string} Output base for "global" assets. */
const globalOutBase = hasSrc ? 'dist/global' : 'dist';

/**
 * Sanitize an entry key (webpack "name") to a safe, portable path.
 * @param {string} p - Potential entry key.
 * @returns {string} A cleaned key containing only [A-Za-z0-9/_-].
 */
const sanitizeKey = (p) => p.replace(/[^a-zA-Z0-9/_-]/g, '');

/**
 * Create a path under the component output root.
 * - In Drupal + src layout, components resolve to "components/…"
 * - Otherwise, they resolve to "dist/components/…"
 * @param {string} subpath - Component-local subpath (no extension).
 * @returns {string} Component output path segment.
 */
const componentOutPath = (subpath) =>
  (isDrupal && hasSrc ? 'components' : 'dist/components') + '/' + subpath;

/**
 * Join segments with POSIX semantics (forward slashes), trimming empties.
 * @param {...string} segs - Path segments.
 * @returns {string} POSIX-joined path.
 */
const pj = (...segs) => path.join(...segs.filter(Boolean));

/**
 * Compute the “dist subpath” for a non-component asset.
 * Inserts a type folder ("js" or "css") when SDC = false.
 * Drops the original file extension.
 * @param {string} absFile - Absolute file path.
 * @param {'js'|'css'} type - Asset type.
 * @returns {string} Subpath under the global output base (no extension).
 */
const distSubpathForBase = (absFile, type) => {
  const rel = path.relative(srcDir, absFile);
  const dir = path.dirname(rel);
  const name = path.basename(rel, '.' + type);
  return SDC ? pj(dir, name) : pj(dir, type, name);
};

/**
 * Compute the “dist subpath” for a component asset located under "…/components".
 * Inserts a type folder ("js" or "css") when SDC = false.
 * Drops the original file extension.
 * @param {string} absFile - Absolute file path.
 * @param {'js'|'scss'} type - Source type (scss maps to 'css').
 * @returns {string} Component-local subpath (no extension).
 */
const distSubpathForComponent = (absFile, type) => {
  const relFromComponents = path.relative(pj(srcDir, 'components'), absFile);
  const dir = path.dirname(relFromComponents);
  const isStyle = type === 'scss';
  const outTypeDir = isStyle ? 'css' : 'js';
  const ext = isStyle ? '.scss' : '.js';
  const name = path.basename(relFromComponents, ext);
  return SDC ? pj(dir, name) : pj(dir, outTypeDir, name);
};

/** @type {Map<string, string | string[]>} */
const entries = new Map();

/**
 * Reject keys that could touch object internals even after sanitization.
 * @param {string} k
 * @returns {boolean}
 */
const isDangerousKey = (k) =>
  k.includes('__proto__') || k.includes('prototype') || k === 'constructor';

/**
 * Add a file under an entry key; if the key exists, merge to an array.
 * Keeps JS before SCSS for deterministic order.
 *
 * @param {Map<string, string | string[]>} map
 * @param {string} key
 * @param {string} file
 * @returns {void}
 */
const addEntry = (map, key, file) => {
  const safeKey = sanitizePath(String(key));
  if (!safeKey || isDangerousKey(safeKey)) return;

  const current = map.get(safeKey);

  if (!current) {
    map.set(safeKey, file);
    return;
  }

  const arr = Array.isArray(current) ? current : [current];
  if (!arr.includes(file)) arr.push(file);

  // Optional: ensure JS comes before SCSS
  arr.sort((a, b) => {
    const ax = a.endsWith('.js') ? 0 : 1;
    const bx = b.endsWith('.js') ? 0 : 1;
    return ax - bx || a.localeCompare(b);
  });

  map.set(safeKey, arr);
};

/**
 * Safe glob wrapper: returns [] if the pattern is falsy.
 * @param {string} pattern - Glob pattern.
 * @returns {string[]} Matching file paths.
 */
const glob = (pattern) => (pattern ? globSync(pattern) : []);

/* -------------------------------------------------------------------------- */
/*                                   GLOBS                                    */
/* -------------------------------------------------------------------------- */

const BaseScssPattern = hasSrc
  ? pj(srcDir, '!(components|util)/**/!(_*|cl-*|sb-*).scss')
  : '';

const ComponentScssPattern = hasSrc
  ? pj(srcDir, 'components/**/!(_*|cl-*|sb-*).scss')
  : pj(srcDir, '**/!(_*|cl-*|sb-*).scss');

const ComponentLibraryScssPattern = pj(srcDir, '**/*{cl-*,sb-*}.scss');

const BaseJsPattern = hasSrc
  ? pj(srcDir, '!(components|util)/**/!(*.stories|*.component|*.min|*.test).js')
  : '';

const ComponentJsPattern = hasSrc
  ? pj(srcDir, 'components/**/!(*.stories|*.component|*.min|*.test).js')
  : pj(srcDir, '**/!(*.stories|*.component|*.min|*.test).js');

/* -------------------------------------------------------------------------- */
/*                                 ENTRY BUILD                                */
/* -------------------------------------------------------------------------- */

/**
 * Build the complete Webpack entries map.
 * @returns {Record<string,string>} Webpack entries.
 */
const buildEntries = () => {
  /** @type {Map<string, string | string[]>} */
  const entries = new Map();

  /* ----------------------------- Base / Global JS ----------------------------- */
  for (const file of glob(BaseJsPattern)) {
    const sub = distSubpathForBase(file, 'js');
    // If no "src/", legacy layout puts global JS directly under "dist/js".
    const outRoot = hasSrc ? pj(globalOutBase) : pj('dist', 'js');
    addEntry(entries, pj(outRoot, sub), file);
  }

  /* --------------------------- Component JS (no dist) -------------------------- */
  for (const file of glob(ComponentJsPattern)) {
    if (file.includes('/dist/')) continue; // guard against accidental recursion
    const sub = distSubpathForComponent(file, 'js');
    addEntry(entries, componentOutPath(sub), file);
  }

  /* ------------------------------ Base / Global CSS --------------------------- */
  for (const file of glob(BaseScssPattern)) {
    const sub = distSubpathForBase(file, 'css');
    // If no "src/", legacy layout puts global CSS directly under "dist/css".
    const outRoot = hasSrc ? pj(globalOutBase) : pj('dist', 'css');
    addEntry(entries, pj(outRoot, sub), file);
  }

  /* ---------------------------- Component CSS (SCSS) --------------------------- */
  for (const file of glob(ComponentScssPattern)) {
    const sub = distSubpathForComponent(file, 'scss'); // maps to css
    addEntry(entries, componentOutPath(sub), file);
  }

  /* -------------------------- Component Library (Storybook) -------------------- */
  for (const file of glob(ComponentLibraryScssPattern)) {
    const rel = path.relative(srcDir, file).replace(/\.scss$/, '');
    addEntry(entries, pj('dist', 'storybook', rel), file);
  }

  return Object.fromEntries(entries);
};

/* -------------------------------------------------------------------------- */
/*                              WEBPACK CONFIG EXPORT                          */
/* -------------------------------------------------------------------------- */

export default {
  target: 'web',
  stats: { errorDetails: true },
  entry: buildEntries(),
  module: {
    rules: [
      loaders.CSSLoader,
      loaders.SVGSpriteLoader,
      loaders.ImageLoader,
      loaders.JSLoader,
      loaders.TwigLoader,
    ],
  },
  plugins: [
    plugins.RemoveEmptyJS,
    plugins.MiniCssExtractPlugin,
    plugins.ImageminPlugin,
    plugins.SpritePlugin,
    plugins.ProgressPlugin,
    plugins.CopyTwigPlugin,
    plugins.CleanWebpackPlugin,
  ],
  output: {
    path: projectDir,
    filename: '[name].js',
  },
  resolve: resolves.TwigResolve,
  optimization: optimizers,
  // Quiet deprecation noise from Sass @import warnings
  ignoreWarnings: [
    (warning) =>
      Boolean(warning?.message) &&
      /Sass @import rules are deprecated/.test(warning.message),
  ],
};
