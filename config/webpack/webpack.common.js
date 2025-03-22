const path = require('path');
const glob = require('glob');
const loaders = require('./loaders');
const plugins = require('./plugins');
const resolves = require('./resolves');
const optimizers = require('./optimizers');
const emulsifyConfig = require('../../../../../project.emulsify.json');
const fs = require('fs-extra');

// Utility to sanitize file paths (to prevent unwanted characters).
const sanitizePath = (inputPath) => inputPath.replace(/[^a-zA-Z0-9/_-]/g, '');

// Get directories for file contexts.
const webpackDir = path.resolve(__dirname);
const projectDir = path.resolve(__dirname, '../../../../..');

const srcPath = path.resolve(projectDir, 'src');
const isSrcExists = fs.existsSync(srcPath);
const srcDir = isSrcExists ? srcPath : path.resolve(projectDir, 'components');

// Glob pattern for scss files that ignore file names prefixed with underscore.
const BaseScssPattern = fs.existsSync(path.resolve(projectDir, 'src'))
  ? path.resolve(srcDir, '!(components|util)/**/!(_*|cl-*|sb-*).scss')
  : '';
const ComponentScssPattern = fs.existsSync(path.resolve(projectDir, 'src'))
  ? path.resolve(srcDir, 'components/**/!(_*|cl-*|sb-*).scss')
  : path.resolve(srcDir, '**/!(_*|cl-*|sb-*).scss');
const ComponentLibraryScssPattern = path.resolve(
  srcDir,
  '**/*{cl-*,sb-*}.scss',
);

// Glob pattern for JS files.
const BaseJsPattern = fs.existsSync(path.resolve(projectDir, 'src'))
  ? path.resolve(
      srcDir,
      '!(components|util)/**/!(*.stories|*.component|*.min|*.test).js',
    )
  : '';
const ComponentJsPattern = fs.existsSync(path.resolve(projectDir, 'src'))
  ? path.resolve(
      srcDir,
      'components/**/!(*.stories|*.component|*.min|*.test).js',
    )
  : path.resolve(srcDir, '**/!(*.stories|*.component|*.min|*.test).js');

// Glob pattern for svgSprite config.
const spritePattern = path.resolve(webpackDir, 'svgSprite.js');

/**
 * Return all scss/js/svg files that Webpack needs to compile.
 * @constructor
 * @param {string} str - Path to file.
 * @param {string} replacement - string to replace str.
 */
function replaceLastSlash(str, replacement) {
  // Find the last occurrence of '/'
  const lastSlashIndex = str.lastIndexOf('/');
  // If there is no '/' in the string, return the original string
  if (lastSlashIndex === -1) {
    return str;
  }
  // Replace the last '/' with the specified replacement
  return (
    str.slice(0, lastSlashIndex) + replacement + str.slice(lastSlashIndex + 1)
  );
}

/**
 * Return all scss/js/svg files that Webpack needs to compile.
 * @constructor
 * @param {string} BaseJsMatcher - Glob pattern.
 * @param {string} jsMatcher - Glob pattern.
 * @param {string} BaseScssMatcher - Glob pattern.
 * @param {string} ComponentScssMatcher - Glob pattern.
 * @param {string} ComponentLibraryScssMatcher - Glob pattern.
 * @param {string} spriteMatcher - Glob pattern.
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

  const addEntry = (key, file) => {
    const sanitizedKey = sanitizePath(key);
    if (
      sanitizedKey &&
      !Object.prototype.hasOwnProperty.call(entries, sanitizedKey)
    ) {
      entries[sanitizedKey] = file;
    }
  };

  // Non-component or global JS entries.
  glob.sync(BaseJsMatcher).forEach((file) => {
    const filePath = file.split(`${srcDir}/`)[1];
    const pathParts = filePath.split('/');
    // Construct the output path by joining all path parts except the last, with "/js/" prefix.
    const filePathDist = `${pathParts.slice(0, -1).join('/')}/js/${pathParts.at(-1).replace('.js', '')}`;
    // Determine if the src directory exists and construct the appropriate path.
    const newFilePath = fs.existsSync(path.resolve(projectDir, 'src'))
      ? `dist/global/${filePathDist}`
      : `dist/js/${filePathDist}`;
    // Add the file to the entries.
    addEntry(newFilePath, file);
  });

  // Component JS entries.
  glob.sync(jsMatcher).forEach((file) => {
    if (!file.includes('dist/')) {
      const filePath = file.split('components/')[1];
      const filePathDist = replaceLastSlash(filePath, '/js/');
      const distStructure = fs.existsSync(path.resolve(projectDir, 'src'))
        ? 'components'
        : 'js';
      const newFilePath =
        emulsifyConfig.project.platform === 'drupal' &&
        fs.existsSync(path.resolve(projectDir, 'src'))
          ? `components/${filePathDist.replace('.js', '')}`
          : `dist/${distStructure}/${filePathDist.replace('.js', '')}`;
      addEntry(newFilePath, file);
    }
  });

  // Non-component or global SCSS entries.
  glob.sync(BaseScssMatcher).forEach((file) => {
    const filePath = file.split(`${srcDir}/`)[1];
    const pathParts = filePath.split('/');

    // Construct the output path by joining all path parts except the last, with "/css/" prefix.
    const filePathDist = `${pathParts.slice(0, -1).join('/')}/css/${pathParts.at(-1).replace('.scss', '')}`;

    // Determine if the src directory exists and construct the appropriate path.
    const newFilePath = fs.existsSync(path.resolve(projectDir, 'src'))
      ? `dist/global/${filePathDist}`
      : `dist/css/${filePathDist}`;

    // Add the file to the entries.
    addEntry(newFilePath, file);
  });

  // Component SCSS entries.-
  glob.sync(ComponentScssMatcher).forEach((file) => {
    const filePath = file.split('components/')[1];
    const filePathDist = replaceLastSlash(filePath, '/css/');
    const distStructure = fs.existsSync(path.resolve(projectDir, 'src'))
      ? 'components'
      : 'css';
    const newFilePath =
      emulsifyConfig.project.platform === 'drupal' &&
      fs.existsSync(path.resolve(projectDir, 'src'))
        ? `components/${filePathDist.replace('.scss', '')}`
        : `dist/${distStructure}/${filePathDist.replace('.scss', '')}`;
    addEntry(newFilePath, file);
  });

  // Component Library SCSS entries.
  glob.sync(ComponentLibraryScssMatcher).forEach((file) => {
    const filePath = file.split(`${srcDir}/`)[1];
    const newFilePath = `dist/storybook/${filePath.replace('.scss', '')}`;
    addEntry(newFilePath, file);
  });

  glob.sync(spriteMatcher).forEach((file) => {
    const filePath = file.split('/webpack/')[1];
    const newFilePath = `dist/${filePath.replace('.js', '')}`;
    addEntry(newFilePath, file);
  });

  return entries;
}

module.exports = {
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
