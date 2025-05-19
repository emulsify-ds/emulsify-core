/**
 * @fileoverview Webpack configuration entry file.
 * This file generates Webpack entries for JS, SCSS, and SVG assets.
 */

import { resolve, dirname } from 'path';
import { sync as globSync } from 'glob';
import fs from 'fs-extra';
import loaders from './loaders.js';
import plugins from './plugins.js';
import resolves from './resolves.js';
import optimizers from './optimizers.js';
import emulsifyConfig from '../../../../../project.emulsify.json' with { type: 'json' };

// Create __filename from import.meta.url without fileURLToPath
let _filename = decodeURIComponent(new URL(import.meta.url).pathname);

// On Windows, remove the leading slash (e.g. "/C:/path" -> "C:/path")
if (process.platform === 'win32' && _filename.startsWith('/')) {
  _filename = _filename.slice(1);
}

const _dirname = dirname(_filename);

/**
 * Sanitize a file path by removing unwanted characters.
 *
 * @param {string} inputPath - The file path to sanitize.
 * @returns {string} The sanitized file path.
 */
const sanitizePath = (inputPath) => inputPath.replace(/[^a-zA-Z0-9/_-]/g, '');

// Get directories for file contexts.
const projectDir = resolve(_dirname, '../../../../..');

const srcPath = resolve(projectDir, 'src');
const isSrcExists = fs.pathExistsSync(srcPath);
const srcDir = isSrcExists ? srcPath : resolve(projectDir, 'components');

// Glob pattern for SCSS files that ignore file names prefixed with underscore.
const BaseScssPattern = fs.pathExistsSync(resolve(projectDir, 'src'))
  ? resolve(srcDir, '!(components|util)/**/!(_*|cl-*|sb-*).scss')
  : '';
const ComponentScssPattern = fs.pathExistsSync(resolve(projectDir, 'src'))
  ? resolve(srcDir, 'components/**/!(_*|cl-*|sb-*).scss')
  : resolve(srcDir, '**/!(_*|cl-*|sb-*).scss');
const ComponentLibraryScssPattern = resolve(srcDir, '**/*{cl-*,sb-*}.scss');

// Glob pattern for JS files.
const BaseJsPattern = fs.pathExistsSync(resolve(projectDir, 'src'))
  ? resolve(
      srcDir,
      '!(components|util)/**/!(*.stories|*.component|*.min|*.test).js',
    )
  : '';
const ComponentJsPattern = fs.pathExistsSync(resolve(projectDir, 'src'))
  ? resolve(srcDir, 'components/**/!(*.stories|*.component|*.min|*.test).js')
  : resolve(srcDir, '**/!(*.stories|*.component|*.min|*.test).js');

// Glob pattern for SVG sprite config.
const spritePattern = resolve(projectDir, 'assets/icons/**/*.svg');

/**
 * Replace the last occurrence of a slash in a string with a replacement.
 *
 * @param {string} str - The original string.
 * @param {string} replacement - The string to replace the last slash with.
 * @returns {string} The modified string.
 */
function replaceLastSlash(str, replacement) {
  const lastSlashIndex = str.lastIndexOf('/');
  if (lastSlashIndex === -1) {
    return str;
  }
  return (
    str.slice(0, lastSlashIndex) + replacement + str.slice(lastSlashIndex + 1)
  );
}

/**
 * Generate Webpack entries for JS, SCSS, and SVG files.
 *
 * @param {string} BaseJsMatcher - Glob pattern for base JS files.
 * @param {string} jsMatcher - Glob pattern for component JS files.
 * @param {string} BaseScssMatcher - Glob pattern for base SCSS files.
 * @param {string} ComponentScssMatcher - Glob pattern for component SCSS files.
 * @param {string} ComponentLibraryScssMatcher - Glob pattern for component library SCSS files.
 * @param {string} spriteMatcher - Glob pattern for SVG sprite configuration.
 * @returns {Object} An object containing the Webpack entries.
 */
function getEntries(
  BaseJsMatcher,
  jsMatcher,
  BaseScssMatcher,
  ComponentScssMatcher,
  ComponentLibraryScssMatcher,
  spriteMatcher,
) {
  const entries = {};

  /**
   * Add an entry to the entries object after sanitizing the key.
   *
   * @param {string} key - The key for the entry.
   * @param {string} file - The file path to associate with the entry.
   */
  const addEntry = (key, file) => {
    const sanitizedKey = sanitizePath(key);
    if (
      sanitizedKey &&
      !Object.prototype.hasOwnProperty.call(entries, sanitizedKey)
    ) {
      // eslint-disable-next-line security/detect-object-injection
      entries[sanitizedKey] = file;
    }
  };

  // Non-component or global JS entries.
  globSync(BaseJsMatcher).forEach((file) => {
    const filePath = file.split(`${srcDir}/`)[1];
    const pathParts = filePath.split('/');
    const filePathDist = `${pathParts.slice(0, -1).join('/')}/js/${pathParts
      .at(-1)
      .replace('.js', '')}`;
    const newFilePath = fs.pathExistsSync(resolve(projectDir, 'src'))
      ? `dist/global/${filePathDist}`
      : `dist/js/${filePathDist}`;
    addEntry(newFilePath, file);
  });

  // Component JS entries.
  globSync(jsMatcher).forEach((file) => {
    if (!file.includes('dist/')) {
      const filePath = file.split('components/')[1];
      const filePathDist = replaceLastSlash(filePath, '/js/');
      const distStructure = fs.pathExistsSync(resolve(projectDir, 'src'))
        ? 'components'
        : 'js';
      const newFilePath =
        emulsifyConfig.project.platform === 'drupal' &&
        fs.pathExistsSync(resolve(projectDir, 'src'))
          ? `components/${filePathDist.replace('.js', '')}`
          : `dist/${distStructure}/${
              distStructure === 'components' ? 'components' : 'js'
            }/${filePathDist.replace('.js', '')}`;
      addEntry(newFilePath, file);
    }
  });

  // Non-component or global SCSS entries.
  globSync(BaseScssMatcher).forEach((file) => {
    const filePath = file.split(`${srcDir}/`)[1];
    const pathParts = filePath.split('/');
    const filePathDist = `${pathParts.slice(0, -1).join('/')}/css/${pathParts
      .at(-1)
      .replace('.scss', '')}`;
    const newFilePath = fs.pathExistsSync(resolve(projectDir, 'src'))
      ? `dist/global/${filePathDist}`
      : `dist/css/${filePathDist}`;
    addEntry(newFilePath, file);
  });

  // Component SCSS entries.
  globSync(ComponentScssMatcher).forEach((file) => {
    const filePath = file.split('components/')[1];
    const filePathDist = replaceLastSlash(filePath, '/css/');
    const distStructure = fs.pathExistsSync(resolve(projectDir, 'src'))
      ? 'components'
      : 'css';
    const newFilePath =
      emulsifyConfig.project.platform === 'drupal' &&
      fs.pathExistsSync(resolve(projectDir, 'src'))
        ? `components/${filePathDist.replace('.scss', '')}`
        : `dist/${distStructure}/${
            distStructure === 'components' ? 'components' : 'css'
          }/${filePathDist.replace('.scss', '')}`;
    addEntry(newFilePath, file);
  });

  // Component Library SCSS entries.
  globSync(ComponentLibraryScssMatcher).forEach((file) => {
    const filePath = file.split(`${srcDir}/`)[1];
    const newFilePath = `dist/storybook/${filePath.replace('.scss', '')}`;
    addEntry(newFilePath, file);
  });

  // SVG sprite config entries.
  globSync(spriteMatcher).forEach((file) => {
    const filePath = file.split('/assets/')[1];
    const newEntry = `dist/${filePath}`;
    addEntry(newEntry, file);
  });

  return entries;
}

export default {
  target: 'web',
  stats: {
    errorDetails: true,
  },
  entry: getEntries(
    BaseJsPattern,
    ComponentJsPattern,
    BaseScssPattern,
    ComponentScssPattern,
    ComponentLibraryScssPattern,
    spritePattern,
  ),
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
    plugins.MiniCssExtractPlugin,
    plugins.ImageminPlugin,
    plugins.SpriteLoaderPlugin,
    plugins.ProgressPlugin,
    plugins.CopyTwigPlugin,
    plugins.CleanWebpackPlugin,
  ],
  output: {
    path: `${projectDir}`,
    filename: '[name].js',
  },
  resolve: resolves.TwigResolve,
  optimization: optimizers,
};
