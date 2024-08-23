/* eslint-disable no-underscore-dangle */
const path = require('path');
const webpack = require('webpack');
const { CleanWebpackPlugin } = require('clean-webpack-plugin');
const _MiniCssExtractPlugin = require('mini-css-extract-plugin');
const _ImageminPlugin = require('imagemin-webpack-plugin').default;
const _SpriteLoaderPlugin = require('svg-sprite-loader/plugin');
const CopyPlugin = require('copy-webpack-plugin');
const glob = require('glob');

// Get directories for file contexts.
const projectDir = path.resolve(__dirname, '../../../../..');
const imagePath = path.resolve(projectDir, 'assets/images');
const srcDir = path.resolve(projectDir, 'src');

// Emulsify project configuration.
const emulsifyConfig = require('../../../../../project.emulsify.json');

// Compress images plugin.
const MiniCssExtractPlugin = new _MiniCssExtractPlugin({
  filename: '[name].css',
  chunkFilename: '[id].css',
});

// Minify CSS plugin.
const ImageminPlugin = new _ImageminPlugin({
  disable: process.env.NODE_ENV !== 'production',
  externalImages: {
    context: imagePath,
    sources: glob.sync(path.resolve(imagePath, '**/*.{png,jpg,gif,svg}')),
    destination: imagePath,
  },
});

// Create SVG sprite.
const SpriteLoaderPlugin = new _SpriteLoaderPlugin({
  plainSprite: true,
});

// Enable Webpack progress plugin.
const ProgressPlugin = new webpack.ProgressPlugin();

// Glob pattern for markup files.
const twigPattern = path.resolve(srcDir, '**/*.{twig,yml}');

// Prepare list of twig files to copy to "compiled" directories.
function getPatterns(twigMatcher) {
  const patterns = [];
  glob.sync(twigMatcher).forEach((file) => {
    const projectPath = file.split('/src/')[0];
    const srcStructure = file.split(`${srcDir}/`)[1];
    const parentDir = srcStructure.split('/')[0];
    const filePath = file.split(/(components\/|layout\/)/)[2];
    const newfilePath =
      emulsifyConfig.project.platform === 'drupal'
        ? `${projectPath}/${parentDir}/${filePath}`
        : `${projectPath}/dist/${parentDir}/${filePath}`;
    patterns.push({
      from: file,
      to: newfilePath,
    });
  });

  return patterns;
}

// Copy twig files from src directory.
const CopyTwigPlugin = new CopyPlugin({
  patterns: getPatterns(twigPattern),
});

module.exports = {
  ProgressPlugin,
  MiniCssExtractPlugin,
  ImageminPlugin,
  SpriteLoaderPlugin,
  CopyTwigPlugin,
  CleanWebpackPlugin: new CleanWebpackPlugin({
    protectWebpackAssets: false, // Required for removal of extra, unwanted dist/css/*.js files.
    cleanOnceBeforeBuildPatterns: ['!*.{png,jpg,gif,svg}'],
    cleanAfterEveryBuildPatterns: [
      'remove/**',
      '!js',
      'css/**/*.js', // Remove all unwanted, auto generated JS files from dist/css folder.
      'css/**/*.js.map',
      '!*.{png,jpg,gif,svg}',
    ],
  }),
};
