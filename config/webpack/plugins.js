/**
 * @fileoverview Configures Webpack plugins.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import webpack from 'webpack';
import { CleanWebpackPlugin } from 'clean-webpack-plugin';
import _MiniCssExtractPlugin from 'mini-css-extract-plugin';
import _SpriteLoaderPlugin from 'svg-sprite-loader/plugin';
import CopyPlugin from 'copy-webpack-plugin';
import { sync as globSync } from 'glob';
import fs from 'fs-extra';
import emulsifyConfig from '../../../../../project.emulsify.json' with { type: 'json' };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const projectDir = path.resolve(__dirname, '../../../../..');
const srcDir = path.resolve(projectDir, 'src');

const MiniCssExtractPlugin = new _MiniCssExtractPlugin({
  filename: '[name].css',
  chunkFilename: '[id].css',
});

const SpriteLoaderPlugin = new _SpriteLoaderPlugin({
  plainSprite: true,
});

const ProgressPlugin = new webpack.ProgressPlugin();

const componentFilesPattern = path.resolve(srcDir, '**/*.{twig,component.yml}');

/**
 * Prepare a list of patterns for copying Twig and component files.
 *
 * @param {string} filesMatcher - Glob pattern for matching files.
 * @returns {Array<Object>} Array of objects with `from` and `to` properties.
 */
function getPatterns(filesMatcher) {
  const patterns = [];
  globSync(filesMatcher).forEach((file) => {
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

const CopyTwigPlugin = fs.existsSync(path.resolve(projectDir, 'src'))
  ? new CopyPlugin({
      patterns: getPatterns(componentFilesPattern),
    })
  : '';

const pluginConfig = {
  ProgressPlugin,
  MiniCssExtractPlugin,
  SpriteLoaderPlugin,
  CopyTwigPlugin,
  CleanWebpackPlugin: new CleanWebpackPlugin({
    protectWebpackAssets: false,
    cleanOnceBeforeBuildPatterns: ['!*.{png,jpg,gif,svg}'],
    cleanAfterEveryBuildPatterns: [
      'remove/**',
      '!js',
      'css/**/*.js',
      'css/**/*.js.map',
      '!*.{png,jpg,gif,svg}',
    ],
  }),
};

export default pluginConfig;
