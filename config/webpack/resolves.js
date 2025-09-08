/**
 * @fileoverview Configures Twig alias resolution for the project.
 * - Builds Twig alias map from files under the source directory
 * - Exposes a Webpack-style `resolve.alias` object for `.twig` files
 */

import { basename, resolve, relative, isAbsolute, join } from 'node:path';
import { sync as globSync } from 'glob';
import fs from 'fs-extra';
import emulsifyConfig from '../../../../../project.emulsify.json' with { type: 'json' };

/**
 * Resolve the directory of this file (without fileURLToPath).
 * @type {string}
 */
let _filename = decodeURIComponent(new URL(import.meta.url).pathname);
if (process.platform === 'win32' && _filename.startsWith('/')) {
  _filename = _filename.slice(1);
}
const _dirname = path.dirname(_filename);

/** @type {string} Absolute project root (five levels up). */
const projectDir = resolve(_dirname, '../../../../..');

/** @type {string} Project machine name used to prefix Drupal aliases. */
const projectName = String(emulsifyConfig?.project?.name || '').trim();

/**
 * Determine the source directory: prefer `<project>/src` if it exists,
 * otherwise use `<project>/components`. If we choose `components` and it
 * does not exist, create it safely inside the project.
 *
 * @returns {string} Absolute path to the source directory.
 */
function resolveOrCreateSrcDir() {
  const srcPreferred = resolve(projectDir, 'src');
  if (fs.pathExistsSync(srcPreferred)) return srcPreferred;

  const componentsFallback = resolve(projectDir, 'components');
  if (!fs.pathExistsSync(componentsFallback)) {
    ensureDirSafe(componentsFallback, {
      base: projectDir,
      allowedBasenames: new Set(['components']),
    });
  }
  return componentsFallback;
}

/**
 * Safely create a directory after validating it is a subpath of `base`
 * and its basename is explicitly allowed. This addresses
 * `security/detect-non-literal-fs-filename`.
 *
 * @param {string} dir - Absolute path to create.
 * @param {{ base: string, allowedBasenames: Set<string> }} opts - Safety options.
 * @returns {void}
 * @throws {Error} If the path is outside `base` or not allowed.
 */
function ensureDirSafe(dir, { base, allowedBasenames }) {
  const rel = relative(base, dir);
  const name = basename(dir);

  // Block absolute or escaping paths (outside of base)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`Refusing to create directory outside project: "${dir}"`);
  }

  // Only allow known, expected directory names
  if (!allowedBasenames.has(name)) {
    throw new Error(`Refusing to create unexpected directory: "${name}"`);
  }

  // The argument is validated; create the directory.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  fs.mkdirSync(dir, { recursive: true });
}

/** @type {string} Absolute source directory. */
const srcDir = resolveOrCreateSrcDir();

/** @type {string} Glob pattern for all non-partial Twig files (skip leading underscores). */
const aliasPattern = resolve(srcDir, '**/!(_*).twig');

/**
 * Read immediate subdirectories from a source directory.
 *
 * @param {string} source - Absolute directory to scan.
 * @returns {string[]} Array of directory names (basenames only).
 */
function getDirectories(source) {
  /* eslint-disable security/detect-non-literal-fs-filename */
  const entries = fs.readdirSync(source, { withFileTypes: true });
  /* eslint-enable security/detect-non-literal-fs-filename */
  return entries.filter((d) => d.isDirectory()).map((d) => d.name);
}

/**
 * Strip a leading two-digit ordering prefix from a directory name
 * (e.g., "01-components" -> "components").
 *
 * @param {string} dir - Original directory name.
 * @returns {string} Cleaned directory name.
 */
function cleanDirectoryName(dir) {
  return /^\d{2}-/.test(dir) ? dir.slice(3) : dir;
}

/**
 * Build a Twig alias object by:
 *  - Adding per-file aliases for Drupal (e.g., "mytheme/button")
 *  - Adding top-level section aliases (e.g., "@components", "@layout")
 *
 * @param {string} twigGlob - Glob pattern to locate Twig files.
 * @returns {Record<string, string>} Alias map ({ alias: absolutePath }).
 */
function getAliases(twigGlob) {
  /** @type {Record<string, string>} */
  const aliases = {};

  // Per-file aliases for Drupal only: "<projectName>/<filename>"
  if (emulsifyConfig?.project?.platform === 'drupal' && projectName) {
    for (const file of globSync(twigGlob)) {
      const relToSrc = relative(srcDir, file);
      const fileName = basename(relToSrc).replace(/\.twig$/, '');
      aliases[`${projectName}/${fileName}`] = file;
    }
  }

  // Top-level "@section" aliases for easier imports
  const topDirs = getDirectories(srcDir);
  for (const dir of topDirs) {
    const name = cleanDirectoryName(dir);
    aliases[`@${name}`] = join(projectDir, basename(srcDir), dir);
  }

  return aliases;
}

/**
 * Webpack-style `resolve` config for Twig files.
 * @typedef {{ extensions: string[], alias: Record<string, string> }} TwigResolveConfig
 */

/** @type {TwigResolveConfig} */
const TwigResolve = {
  extensions: ['.twig'],
  alias: getAliases(aliasPattern),
};

export default { TwigResolve };
