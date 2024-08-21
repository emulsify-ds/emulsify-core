const path = require('path');
const glob = require('glob');
const loaders = require('./loaders');
const plugins = require('./plugins');

// Get directories for file contexts.
const webpackDir = path.resolve(__dirname);
const rootDir = path.resolve(__dirname, '../../../../..');

// Glob pattern for scss files that ignore file names prefixed with underscore.
const BaseScssPattern = path.resolve(
  rootDir,
  '{tokens,foundation,layout}/**/!(_*).scss',
);
const ComponentScssPattern = path.resolve(rootDir, 'components/**/!(_*).scss');
// Glob pattern for JS files.
const jsPattern = path.resolve(
  rootDir,
  'components/**/!(*.stories|*.component|*.min|*.test).js',
);

// Prepare list of scss and js file for "entry".
function getEntries(BaseScssMatcher, ComponentScssMatcher, jsMatcher) {
  const entries = {};

  // Token/Foundation/Layout SCSS entries
  glob.sync(BaseScssMatcher).forEach((file) => {
    const filePath = file.split(/(tokens\/|foundation\/|layout\/)/)[2];
    const filePathDist = filePath.split('/')[1]
      ? filePath.split('/')[1]
      : filePath.split('/')[0];
    const newfilePath = `dist/${filePathDist.replace('.scss', '')}`;
    entries[newfilePath] = file;
  });

  // Component SCSS entries
  glob.sync(ComponentScssMatcher).forEach((file) => {
    const filePath = file.split('components/')[1];
    const filePathDist = filePath.replace('/', '/dist/css/');
    const newfilePath = `components/${filePathDist.replace('.scss', '')}`;
    entries[newfilePath] = file;
  });

  // JS entries
  glob.sync(jsMatcher).forEach((file) => {
    if (!file.includes('dist/')) {
      const filePath = file.split('components/')[1];
      const filePathDist = filePath.replace('/', '/dist/js/');
      const newfilePath = `components/${filePathDist.replace('.js', '')}`;
      entries[newfilePath] = file;
    }
  });

  entries.svgSprite = path.resolve(webpackDir, 'svgSprite.js');

  return entries;
}

module.exports = {
  stats: {
    errorDetails: true,
  },
  entry: getEntries(BaseScssPattern, ComponentScssPattern, jsPattern),
  module: {
    rules: [
      loaders.CSSLoader,
      loaders.SVGSpriteLoader,
      loaders.ImageLoader,
      loaders.JSLoader,
    ],
  },
  plugins: [
    plugins.MiniCssExtractPlugin,
    plugins.ImageminPlugin,
    plugins.SpriteLoaderPlugin,
    plugins.ProgressPlugin,
    plugins.CleanWebpackPlugin,
  ],
  output: {
    path: `${rootDir}`,
    filename: '[name].js',
  },
};
