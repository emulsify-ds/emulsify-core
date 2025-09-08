import { resolve, dirname } from 'path';
import webpack from 'webpack';
import { CleanWebpackPlugin } from 'clean-webpack-plugin';
import RemoveEmptyScriptsPlugin from 'webpack-remove-empty-scripts';
import MiniCssExtractPlugin from 'mini-css-extract-plugin';
import SVGSpritemapPlugin from 'svg-spritemap-webpack-plugin';
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
 * Project root (five levels up).
 * @type {string}
 */
const projectDir = resolve(_dirname, '../../../../..');

/**
 * Where source files live.
 * Prefer `<project>/src`; fall back to `<project>/components` (legacy layout).
 * @type {string}
 */
const srcPath = resolve(projectDir, 'src');
const isSrcExists = fs.pathExistsSync(srcPath);
const srcDir = isSrcExists ? srcPath : resolve(projectDir, 'components');

/**
 * Where built assets live.
 * If `src/` exists, use `<project>/dist`; else write into `<project>/components`.
 * @type {string}
 */
const distPath = isSrcExists
  ? resolve(projectDir, 'dist')
  : resolve(projectDir, 'components');

/**
 * Platform switch (affects component output roots).
 * @type {boolean}
 */
const isDrupal = emulsifyConfig?.project?.platform === 'drupal';

/**
 * Component source root:
 *  - with src/: `<project>/src/components`
 *  - without src/: `<project>/components`
 * @type {string}
 */
const componentsSrcRoot = isSrcExists ? resolve(srcDir, 'components') : srcDir;

/**
 * Component output root (where compiled component assets go):
 *  - Drupal + src/: `components/…`
 *  - Otherwise:     `dist/components/…`
 * (Relative to `projectDir`; used by CopyPlugin’s `to:` path.)
 * @type {string}
 */
const componentsOutRoot =
  isDrupal && isSrcExists ? 'components' : 'dist/components';

/**
 * Glob pattern for Twig & component meta files. These are copied as-is so
 * Drupal/WordPress themes can consume them alongside compiled assets.
 * @type {string}
 */
const componentFilesPattern = resolve(
  srcDir,
  '**/*.{twig,component.yml,component.json}',
);

/**
 * Build CopyPlugin patterns from a glob matcher, preserving source structure.
 *
 * @param {string} filesMatcher - Glob for files to mirror.
 * @returns {Array<{from:string,to:string}>} Copy patterns for CopyPlugin.
 */
function getPatterns(filesMatcher) {
  return globSync(filesMatcher).map((file) => {
    const projectPath = file.split('/src/')[0]; // base path before /src/
    const srcStructure = file.split(`${srcDir}/`)[1];
    const parentDir = srcStructure.split('/')[0];

    // Consolidate foundation/layout under "components" for Drupal.
    const consolidateDirs =
      parentDir === 'layout' || parentDir === 'foundation'
        ? '/components/'
        : '/';
    const filePath = file.split(/(foundation\/|components\/|layout\/)/)[2];
    const to = isDrupal
      ? `${projectPath}${consolidateDirs}${parentDir}/${filePath}`
      : `${projectPath}/dist/${parentDir}/${filePath}`;

    return { from: file, to };
  });
}

/**
 * CopyPlugin instance (only when `src/` exists):
 * copies Twig and component meta files 1:1 into their expected destinations.
 * @type {CopyPlugin|false}
 */
const CopyTwigPlugin = isSrcExists
  ? new CopyPlugin({ patterns: getPatterns(componentFilesPattern) })
  : false;

/**
 * CopyPlugin instance: copies **component-local assets** (images, fonts, SVGs, etc.)
 *
 * Example:
 *   src/components/accordion/assets/dropdown-icon.svg
 * -> (Drupal+src) components/accordion/assets/dropdown-icon.svg
 * -> (WP/legacy)  dist/components/accordion/assets/dropdown-icon.svg
 *
 * Notes:
 * - `context` is set to the component source root so `[path]` starts **after**
 *   `…/components/`.
 * - `to` uses `[path][name][ext]` to mirror the original tree.
 * - `noErrorOnMissing` avoids errors if no assets are present.
 * @type {CopyPlugin}
 */
const CopyComponentAssetsPlugin = new CopyPlugin({
  patterns: [
    {
      from: '**/assets/**/*',
      context: componentsSrcRoot,
      to: resolve(projectDir, componentsOutRoot, '[path][name][ext]'),
      noErrorOnMissing: true,
      globOptions: {
        dot: false,
        ignore: ['**/.DS_Store', '**/Thumbs.db'],
      },
    },
  ],
});

/**
 * CopyPlugin instance for **global (non-component) assets** that live
 * under `src/` but *outside* `src/components/`.
 *
 * These are mirrored under `dist/global/…` (because your base SCSS/JS already
 * use the `dist/global` convention).
 *
 * Disabled when there is no `src/` directory.
 * @type {CopyPlugin|false}
 */
const CopyGlobalAssetsPlugin = isSrcExists
  ? new CopyPlugin({
      patterns: [
        {
          from: '!(components|util)/**/assets/**/*',
          context: srcDir,
          to: resolve(projectDir, 'dist', 'global', '[path][name][ext]'),
          noErrorOnMissing: true,
          globOptions: {
            dot: false,
            ignore: ['**/.DS_Store', '**/Thumbs.db'],
          },
        },
      ],
    })
  : false;

/**
 * CleanWebpackPlugin configuration.
 * Wipes out compiled CSS/JS in `distPath` before a build; keeps images.
 */
const CleanPlugin = new CleanWebpackPlugin({
  protectWebpackAssets: false,
  cleanOnceBeforeBuildPatterns: [
    `${distPath}/**/*.css`,
    `${distPath}/**/*.js`,
    `!${distPath}/**/*.png`,
    `!${distPath}/**/*.jpg`,
    `!${distPath}/**/*.gif`,
    `!${distPath}/**/*.svg`,
  ],
});

/** Removes empty JS files generated for style-only entries. */
const RemoveEmptyJS = new RemoveEmptyScriptsPlugin();

/**
 * MiniCssExtractPlugin: emit CSS next to the entry key path (no hard-coded dist/).
 */
const CssExtractPlugin = new MiniCssExtractPlugin({
  filename: ({ chunk }) => `${chunk.name}.css`,
  chunkFilename: ({ chunk }) => `${chunk.name}.css`,
});

/**
 * Generate a single SVG spritemap at `dist/icons.svg`.
 */
const SpritePlugin = new SVGSpritemapPlugin(
  resolve(projectDir, 'assets/icons/**/*.svg'),
  {
    output: {
      filename: 'dist/icons.svg',
      chunk: { keep: true },
    },
    sprite: {
      prefix: '',
      generate: { title: false },
    },
  },
);

/** Build progress output. */
const ProgressPlugin = new webpack.ProgressPlugin();

/**
 * Export plugin instances keyed for easy inclusion in your Webpack config.
 */
export default {
  ProgressPlugin,
  CleanWebpackPlugin: CleanPlugin,
  RemoveEmptyJS,
  MiniCssExtractPlugin: CssExtractPlugin,
  SpritePlugin,
  CopyTwigPlugin,
  CopyComponentAssetsPlugin,
  CopyGlobalAssetsPlugin,
};
