const path = require('path');
const glob = require('glob');
const loaders = require('./loaders');
const plugins = require('./plugins');
const resolves = require('./resolves');
const optimizers = require('./optimizers');
const emulsifyConfig = require('../../../../../project.emulsify.json');
const fs = require('fs-extra');

// Get directories for file contexts.
const webpackDir = path.resolve(__dirname);
const projectDir = path.resolve(__dirname, '../../../../..');
const srcDir = fs.existsSync(path.resolve(projectDir, 'src'))
  ? path.resolve(projectDir, 'src')
  : path.resolve(projectDir, 'components');

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
const jsPattern = fs.existsSync(path.resolve(projectDir, 'src'))
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
 * @param {string} BaseScssMatcher - Glob pattern.
 * @param {string} ComponentScssMatcher - Glob pattern.
 * @param {string} ComponentLibraryScssMatcher - Glob pattern.
 * @param {string} jsMatcher - Glob pattern.
 * @param {string} spriteMatcher - Glob pattern.
 */
function getEntries(
  BaseScssMatcher,
  ComponentScssMatcher,
  ComponentLibraryScssMatcher,
  jsMatcher,
  spriteMatcher,
) {
  const entries = {};

  // Non-component or global SCSS entries.
  glob.sync(BaseScssMatcher).forEach((file) => {
    const filePath = file.split(`${srcDir}/`)[1];
    // Support multi-level folder structures.
    let filePathDist = filePath.split('/')[0];
    if (filePath.split('/')[1] && !filePath.split('/')[1].endsWith('.scss')) {
      filePathDist = filePath.split('/')[1];
    }
    if (filePath.split('/')[2]) {
      filePathDist = `${filePath.split('/')[1]}/${filePath.split('/')[2]}`;
    }
    const newfilePath = fs.existsSync(path.resolve(projectDir, 'src'))
      ? `dist/global/${filePathDist.replace('.scss', '')}`
      : `dist/css/${filePathDist.replace('.scss', '')}`;
    entries[newfilePath] = file;
  });

  // Component SCSS entries.-
  glob.sync(ComponentScssMatcher).forEach((file) => {
    const filePath = file.split('components/')[1];
    const filePathDist = replaceLastSlash(filePath, '/css/');
    const distStructure = fs.existsSync(path.resolve(projectDir, 'src'))
      ? 'components'
      : 'css';
    const newfilePath =
      emulsifyConfig.project.platform === 'drupal' &&
      fs.existsSync(path.resolve(projectDir, 'src'))
        ? `components/${filePathDist.replace('.scss', '')}`
        : `dist/${distStructure}/${filePathDist.replace('.scss', '')}`;
    entries[newfilePath] = file;
  });

  // Component Library SCSS entries.
  glob.sync(ComponentLibraryScssMatcher).forEach((file) => {
    const filePath = file.split(`${srcDir}/`)[1];
    const newfilePath = `dist/storybook/${filePath.replace('.scss', '')}`;
    entries[newfilePath] = file;
  });

  // JS entries.
  glob.sync(jsMatcher).forEach((file) => {
    if (!file.includes('dist/')) {
      const filePath = file.split('components/')[1];
      const filePathDist = replaceLastSlash(filePath, '/js/');
      const distStructure = fs.existsSync(path.resolve(projectDir, 'src'))
        ? 'components'
        : 'js';
      const newfilePath =
        emulsifyConfig.project.platform === 'drupal' &&
        fs.existsSync(path.resolve(projectDir, 'src'))
          ? `components/${filePathDist.replace('.js', '')}`
          : `dist/${distStructure}/${filePathDist.replace('.js', '')}`;
      entries[newfilePath] = file;
    }
  });

  glob.sync(spriteMatcher).forEach((file) => {
    const filePath = file.split('/webpack/')[1];
    const newfilePath = `dist/${filePath.replace('.js', '')}`;
    entries[newfilePath] = file;
  });

  return entries;
}

module.exports = {
  stats: {
    errorDetails: true,
  },
  entry: getEntries(
    BaseScssPattern,
    ComponentScssPattern,
    ComponentLibraryScssPattern,
    jsPattern,
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
