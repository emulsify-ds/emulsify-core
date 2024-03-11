const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const globImporter = require('node-sass-glob-importer');
const fs = require('fs-extra');
let babelConfig;
let postcssConfig;

// Check if custom babel config is available.
if (fs.existsSync('./config/babel.config.js')) {
  babelConfig = './config/babel.config.js';
} else {
  babelConfig = './node_modules/emulsify-core/config/babel.config.js';
}

// Check if custom postcss config is available.
if (fs.existsSync('./config/postcss.config.js')) {
  postcssConfig = './config/postcss.config.js';
} else {
  postcssConfig = './node_modules/emulsify-core/config/postcss.config.js';
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
  test: /\.(png|svg|jpg|gif)$/i,
  exclude: /icons\/.*\.svg$/,
  loader: 'file-loader',
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
        sourceMap: true,
        sassOptions: {
          importer: globImporter(),
          outputStyle: 'compressed',
        },
      },
    },
  ],
};

const SVGSpriteLoader = {
  test: /icons\/.*\.svg$/, // your icons directory
  loader: 'svg-sprite-loader',
  options: {
    extract: true,
    runtimeCompat: true,
    spriteFilename: '../../../../dist/icons.svg',
  },
};

module.exports = {
  JSLoader,
  CSSLoader,
  SVGSpriteLoader,
  ImageLoader,
};
