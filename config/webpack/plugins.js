/**
 * @fileoverview Configures Webpack plugins.
 */

import { resolve, dirname } from 'path';
import webpack from 'webpack';
import { CleanWebpackPlugin } from 'clean-webpack-plugin';
import _MiniCssExtractPlugin from 'mini-css-extract-plugin';
import _SpriteLoaderPlugin from 'svg-sprite-loader/plugin.js';
import CopyPlugin from 'copy-webpack-plugin';
import { sync as globSync } from 'glob';
import fs from 'fs-extra';
import emulsifyConfig from '../../../../../project.emulsify.json' with { type: 'json' };

// Create __filename from import.meta.url without fileURLToPath
let _filename = decodeURIComponent(new URL(import.meta.url).pathname);

// On Windows, remove the leading slash (e.g. "/C:/path" -> "C:/path")
if (process.platform === 'win32' && _filename.startsWith('/')) {
  _filename = _filename.slice(1);
}

const _dirname = dirname(_filename);

const projectDir = resolve(_dirname, '../../../../..');
const srcDir = resolve(projectDir, 'src');

const MiniCssExtractPlugin = new _MiniCssExtractPlugin({
  filename: '[name].css',
  chunkFilename: '[id].css',
});

const SpriteLoaderPlugin = new _SpriteLoaderPlugin({
  plainSprite: true,
});

const ProgressPlugin = new webpack.ProgressPlugin();

const componentFilesPattern = resolve(srcDir, '**/*.{twig,component.yml}');

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

const CopyTwigPlugin = fs.existsSync(resolve(projectDir, 'src'))
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
