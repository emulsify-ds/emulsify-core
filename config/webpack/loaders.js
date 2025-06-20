/**
 * @fileoverview Webpack loader configurations for Emulsify Core and per-project overrides.
 *
 * This module exports a single default object containing loader definitions for:
 *   - JavaScript (with Babel)
 *   - Sass/CSS (with PostCSS + Autoprefixer or project overrides)
 *   - Images
 *   - SVG sprites
 *   - Twig templates
 *
 * It will look for these override files in your project:
 *   - ./config/emulsify-core/webpack/babel.config.cjs
 *   - ./config/emulsify-core/webpack/postcss.config.cjs
 *
 * If not found, it falls back to the package defaults.
 */

import { createRequire } from 'module';
import MiniCssExtractPlugin from 'mini-css-extract-plugin';
import globImporter from 'node-sass-glob-importer';
import fs from 'fs-extra';
import path from 'path';

const require = createRequire(import.meta.url);

/** @type {string} Path to the active Babel config file. */
const babelConfig = fs.existsSync(
  './config/emulsify-core/webpack/babel.config.cjs',
)
  ? './config/emulsify-core/webpack/babel.config.cjs'
  : require.resolve('@emulsify/core/config/babel.config.js');

/** @type {string} Path to the active PostCSS config file. */
const postcssConfigPath = fs.existsSync(
  './config/emulsify-core/webpack/postcss.config.cjs',
)
  ? path.resolve('config/emulsify-core/webpack/postcss.config.cjs')
  : require.resolve('@emulsify/core/config/postcss.config.js');

/**
 * @type {import('webpack').RuleSetRule}
 * JavaScript loader: transpile with Babel.
 */
const JSLoader = {
  test: /^(?!.*\.(stories|component)\.js$).*\.js$/,
  exclude: /node_modules/,
  use: {
    loader: 'babel-loader',
    options: {
      configFile: babelConfig,
    },
  },
};

/**
 * @type {import('webpack').RuleSetRule}
 * CSS/Sass loader chain:
 *   - extract to file
 *   - css-loader (no URL rewriting)
 *   - postcss-loader (project or default)
 *   - sass-loader (with glob importer + compressed output)
 */
const CSSLoader = {
  test: /\.s[ac]ss$/i,
  exclude: /node_modules/,
  use: [
    MiniCssExtractPlugin.loader,
    {
      loader: 'css-loader',
      options: {
        sourceMap: true,
        url: false,
      },
    },
    {
      loader: 'postcss-loader',
      options: {
        sourceMap: true,
        postcssOptions: {
          config: postcssConfigPath,
        },
      },
    },
    {
      loader: 'sass-loader',
      options: {
        api: 'legacy',
        sourceMap: true,
        implementation: require('sass'),
        webpackImporter: true,
        sassOptions: {
          importer: globImporter(),
          legacyImporter: true,
          outputStyle: 'compressed',
          silenceDeprecations: ['legacy-js-api'],
          quietDeps: true,
        },
      },
    },
  ],
};

/**
 * @type {import('webpack').RuleSetRule}
 * Image loader: inlines small assets, emits larger ones.
 */
const ImageLoader = {
  test: /\.(png|jpe?g|gif)$/i,
  type: 'asset',
};

/**
 * @type {import('webpack').RuleSetRule}
 * SVG sprite loader: collects all /icons/*.svg into one sprite.
 */
const SVGSpriteLoader = {
  test: /icons\/.*\.svg$/,
  use: [
    {
      loader: 'svg-sprite-loader',
      options: {
        extract: true,
        esModule: true,
        runtimeCompat: true,
        outputPath: 'dist/',
        spriteFilename: './icons.svg',
      },
    },
  ],
};

/**
 * @type {import('webpack').RuleSetRule}
 * Twig.js loader for .twig templates.
 */
const TwigLoader = {
  test: /\.twig$/,
  use: {
    loader: 'twigjs-loader',
  },
};

/**
 * Default export of all loader configurations.
 * @type {{ JSLoader: import('webpack').RuleSetRule, CSSLoader: import('webpack').RuleSetRule, ImageLoader: import('webpack').RuleSetRule, SVGSpriteLoader: import('webpack').RuleSetRule, TwigLoader: import('webpack').RuleSetRule }}
 */
export default {
  JSLoader,
  CSSLoader,
  ImageLoader,
  SVGSpriteLoader,
  TwigLoader,
};
