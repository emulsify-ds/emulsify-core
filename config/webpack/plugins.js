import { resolve, dirname } from 'path';
import webpack from 'webpack';
import { CleanWebpackPlugin } from 'clean-webpack-plugin';
import MiniCssExtractPlugin from 'mini-css-extract-plugin';
import SpriteLoaderPlugin from 'svg-sprite-loader/plugin.js';
import CopyPlugin from 'copy-webpack-plugin';
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
const _dirname = dirname(_filename);

/**
 * Root of the project (three levels up from this file).
 * @type {string}
 */
const projectDir = resolve(_dirname, '../../../../..');

/**
 * Where your source files live (if you have a `/src` folder).
 * Falls back to `components/` if `src/` does not exist.
 * @type {string}
 */
const srcPath = resolve(projectDir, 'src');
const isSrcExists = fs.pathExistsSync(srcPath);
const srcDir = isSrcExists ? srcPath : resolve(projectDir, 'components');

/**
 * Where your built assets should live.
 * Mirrors the `srcDir` logic: prefer `dist/` if you have `src/`, else `components/`.
 * @type {string}
 */
const distPath = isSrcExists
  ? resolve(projectDir, 'dist')
  : resolve(projectDir, 'components');

/**
 * Glob pattern for all Twig & component files in your source.
 * We copy these through CopyPlugin so your PHP/Drupal theme sees them.
 * @type {string}
 */
const componentFilesPattern = resolve(
  srcDir,
  '**/*.{twig,component.yml,component.json}',
);

/**
 * Turn a globbed source list into copy patterns.
 *
 * @param {string} filesMatcher Glob pattern.
 * @returns {Array<{from:string,to:string}>}
 */
function getPatterns(filesMatcher) {
  return globSync(filesMatcher).map((file) => {
    const projectPath = file.split('/src/')[0];
    const srcStructure = file.split(`${srcDir}/`)[1];
    const parentDir = srcStructure.split('/')[0];
    // Consolidate foundation/layout under components for Drupal.
    const consolidateDirs =
      parentDir === 'layout' || parentDir === 'foundation'
        ? '/components/'
        : '/';
    const filePath = file.split(/(foundation\/|components\/|layout\/)/)[2];
    const destDir =
      emulsifyConfig.project.platform === 'drupal'
        ? `${projectPath}${consolidateDirs}${parentDir}/${filePath}`
        : `${projectPath}/dist/${parentDir}/${filePath}`;
    return { from: file, to: destDir };
  });
}

/**
 * Only include CopyPlugin if we actually have a `src/` folder.
 * @type {CopyPlugin|false}
 */
const CopyTwigPlugin = isSrcExists
  ? new CopyPlugin({ patterns: getPatterns(componentFilesPattern) })
  : false;

/**
 * CleanWebpackPlugin configuration.
 * Wipes out everything in `distPath` before a build,
 * except image files (we whitelist common image extensions).
 */
const CleanPlugin = new CleanWebpackPlugin({
  protectWebpackAssets: false,
  cleanOnceBeforeBuildPatterns: [
    // wipe all compiled assets
    `${distPath}/**/*.css`,
    `${distPath}/**/*.js`,
    // but keep any images
    `!${distPath}/**/*.png`,
    `!${distPath}/**/*.jpg`,
    `!${distPath}/**/*.gif`,
    `!${distPath}/**/*.svg`,
  ],
});

/**
 * MiniCssExtractPlugin instance: writes `[name].css` into your dist.
 */
const CssExtractPlugin = new MiniCssExtractPlugin({
  filename: '[name].css',
  chunkFilename: '[id].css',
});

/**
 * svg-sprite-loader plugin: bundles all /icons/*.svg.
 */
const SpritePlugin = new SpriteLoaderPlugin({
  plainSprite: true,
});

/**
 * webpack.ProgressPlugin for nice build progress output.
 */
const ProgressPlugin = new webpack.ProgressPlugin();

/**
 * Export all plugins keyed for easy inclusion in your final Webpack config.
 */
export default {
  ProgressPlugin,
  CleanWebpackPlugin: CleanPlugin,
  MiniCssExtractPlugin: CssExtractPlugin,
  SpriteLoaderPlugin: SpritePlugin,
  CopyTwigPlugin,
};
