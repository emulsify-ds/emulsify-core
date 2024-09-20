/* eslint-disable no-underscore-dangle */
const path = require('path');
const webpack = require('webpack');
const { CleanWebpackPlugin } = require('clean-webpack-plugin');
const _MiniCssExtractPlugin = require('mini-css-extract-plugin');
const _SpriteLoaderPlugin = require('svg-sprite-loader/plugin');
const CopyPlugin = require('copy-webpack-plugin');
const glob = require('glob');
const fs = require('fs-extra');

// Get directories for file contexts.
const projectDir = path.resolve(__dirname, '../../../../..');
const srcDir = path.resolve(projectDir, 'src');

// Emulsify project configuration.
const emulsifyConfig = require('../../../../../project.emulsify.json');

// Compress images plugin.
const MiniCssExtractPlugin = new _MiniCssExtractPlugin({
  filename: '[name].css',
  chunkFilename: '[id].css',
});

// Create SVG sprite.
const SpriteLoaderPlugin = new _SpriteLoaderPlugin({
  plainSprite: true,
});

// Enable Webpack progress plugin.
const ProgressPlugin = new webpack.ProgressPlugin();

// Glob pattern for markup files.
const componentFilesPattern = path.resolve(srcDir, '**/*.{twig,component.yml}');

/**
 * Prepare list of twig files to copy to "compiled" directories.
 * @constructor
 * @param {string} filesMatcher - Glob pattern.
 */
function getPatterns(filesMatcher) {
  const patterns = [];
  glob.sync(filesMatcher).forEach((file) => {
    const projectPath = file.split('/src/')[0];
    const srcStructure = file.split(`${srcDir}/`)[1];
    const parentDir = srcStructure.split('/')[0];
    const filePath = file.split(/(foundation\/|components\/|layout\/)/)[2];
    const consolidateDirs =
      parentDir === 'layout' || parentDir === 'foundation'
        ? '/components/'
        : '/';
    const newfilePath =
      emulsifyConfig.project.platform === 'drupal'
        ? `${projectPath}${consolidateDirs}${parentDir}/${filePath}`
        : `${projectPath}/dist/${parentDir}/${filePath}`;
    patterns.push({
      from: file,
      to: newfilePath,
    });
  });

  return patterns;
}

// Copy twig files from src directory.
const CopyTwigPlugin = fs.existsSync(path.resolve(projectDir, 'src'))
  ? new CopyPlugin({
      patterns: getPatterns(componentFilesPattern),
    })
  : '';

// Export plugin configuration.
module.exports = {
  ProgressPlugin,
  MiniCssExtractPlugin,
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
