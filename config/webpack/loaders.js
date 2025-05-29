/**
 * @fileoverview Configures Webpack loaders.
 */

import MiniCssExtractPlugin from 'mini-css-extract-plugin';
import globImporter from 'node-sass-glob-importer';
import fs from 'fs-extra';

let babelConfig;
let postcssConfig;

// Check if custom babel config is available.
if (fs.existsSync('./config/emulsify-core/webpack/babel.config.cjs')) {
  babelConfig = './config/emulsify-core/webpack/babel.config.cjs';
} else {
  babelConfig = './node_modules/@emulsify/core/config/babel.config.js';
}

// Check if custom postcss config is available.
if (fs.existsSync('./config/emulsify-core/webpack/postcss.config.cjs')) {
  postcssConfig = './config/emulsify-core/webpack/postcss.config.cjs';
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
