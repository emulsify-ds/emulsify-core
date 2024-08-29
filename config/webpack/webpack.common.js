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

console.log(projectDir);
console.log(srcDir);

// Glob pattern for scss files that ignore file names prefixed with underscore.
const BaseScssPattern = path.resolve(
  srcDir,
  '{tokens,foundation,layout}/**/!(_*|cl-*|sb-*).scss',
);
const ComponentScssPattern = path.resolve(
  srcDir,
  'components/**/!(_*|cl-*|sb-*).scss',
);
const ComponentLibraryScssPattern = path.resolve(srcDir, 'util/**/!(_).scss');

// Glob pattern for JS files.
const jsPattern = path.resolve(
  srcDir,
  'components/**/!(*.stories|*.component|*.min|*.test).js',
);

// Glob pattern for svgSprite config.
const spritePattern = path.resolve(webpackDir, 'svgSprite.js');

// Prepare list of scss and js file for "entry".
function getEntries(
  BaseScssMatcher,
  ComponentScssMatcher,
  ComponentLibraryScssMatcher,
  jsMatcher,
  spriteMatcher,
) {
  const entries = {};

  // Token/Foundation/Layout SCSS entries.
  glob.sync(BaseScssMatcher).forEach((file) => {
    const filePath = file.split(/(tokens\/|foundation\/|layout\/)/)[2];
    const filePathDist = filePath.split('/')[1]
      ? filePath.split('/')[1]
      : filePath.split('/')[0];
    const newfilePath = `dist/global/${filePathDist.replace('.scss', '')}`;
    entries[newfilePath] = file;
  });

  // Component SCSS entries.
  glob.sync(ComponentScssMatcher).forEach((file) => {
    const filePath = file.split('components/')[1];
    const filePathDist = filePath.replace('/', '/css/');
    const newfilePath =
      emulsifyConfig.project.platform === 'drupal'
        ? `components/${filePathDist.replace('.scss', '')}`
        : `dist/components/${filePathDist.replace('.scss', '')}`;
    entries[newfilePath] = file;
  });

  // Component Library SCSS entries.
  glob.sync(ComponentLibraryScssMatcher).forEach((file) => {
    const filePath = file.split(/util/)[1];
    const newfilePath = `dist/storybook/${filePath.replace('.scss', '')}`;
    entries[newfilePath] = file;
  });

  // JS entries.
  glob.sync(jsMatcher).forEach((file) => {
    if (!file.includes('dist/')) {
      const filePath = file.split('components/')[1];
      const filePathDist = filePath.replace('/', '/js/');
      const newfilePath =
        emulsifyConfig.project.platform === 'drupal'
          ? `components/${filePathDist.replace('.js', '')}`
          : `dist/components/${filePathDist.replace('.js', '')}`;
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
