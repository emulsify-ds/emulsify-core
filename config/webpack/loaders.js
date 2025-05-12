/**
 * @fileoverview Configures Webpack loaders.
 */

import { resolve, dirname } from 'path';
import MiniCssExtractPlugin from 'mini-css-extract-plugin';
import globImporter from 'node-sass-glob-importer';
import fs from 'fs-extra';

let babelConfig;
let postcssConfig;
// Create __filename from import.meta.url without fileURLToPath
let _filename = decodeURIComponent(new URL(import.meta.url).pathname);

// On Windows, remove the leading slash (e.g. "/C:/path" -> "C:/path")
if (process.platform === 'win32' && _filename.startsWith('/')) {
  _filename = _filename.slice(1);
}

const _dirname = dirname(_filename);

const projectDir = resolve(_dirname, '../../../../..');

// Check if custom babel config is available.
if (fs.existsSync('./config/babel.config.js')) {
  babelConfig = './config/babel.config.js';
} else {
  babelConfig = './node_modules/@emulsify/core/config/babel.config.js';
}

// Check if custom postcss config is available.
if (fs.existsSync('./config/postcss.config.js')) {
  postcssConfig = './config/postcss.config.js';
} else {
  postcssConfig = './node_modules/@emulsify/core/config/postcss.config.js';
}

const JSLoader = {
  test: /^(?!.*\.(stories|component)\.js$).*\.js$/,
  exclude: /node_modules/,
  loader: 'babel-loader',
  options: {
    configFile: babelConfig,
  },
};

const ImageLoader = {
  test: /\.(png|jpe?g|gif)$/i,
  type: 'asset',
};

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
          config: postcssConfig,
          plugins: [['autoprefixer']],
        },
      },
    },
    {
      loader: 'sass-loader',
      options: {
        api: 'legacy',
        sourceMap: true,
        sassOptions: {
          importer: globImporter(),
          outputStyle: 'compressed',
          silenceDeprecations: ['legacy-js-api'],
        },
      },
    },
  ],
};

const SVGSpriteLoader = {
  test: /icons\/.*\.svg$/,
  include: resolve(projectDir, 'assets/icons'),
  use: [
    {
      loader: 'svg-sprite-loader',
      options: {
        extract: true,
        runtimeCompat: true,
        outputPath: 'dist/',
        spriteFilename: 'icons.svg',
      },
    },
    'svgo-loader',
  ],
};

const TwigLoader = {
  test: /\.twig$/,
  use: {
    loader: 'twigjs-loader',
  },
};

export default {
  JSLoader,
  CSSLoader,
  SVGSpriteLoader,
  ImageLoader,
  TwigLoader,
};
