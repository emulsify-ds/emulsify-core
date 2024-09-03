const ImageMinimizerPlugin = require('image-minimizer-webpack-plugin');

const ImageMinimizer = new ImageMinimizerPlugin({
  minimizer: {
    implementation: ImageMinimizerPlugin.imageminMinify,
    options: {
      plugins: [
        ['gifsicle', { interlaced: true }],
        ['jpegtran', { progressive: true }],
        ['optipng', { optimizationLevel: 5 }],
      ],
    },
  },
});

module.exports = {
  minimizer: [ImageMinimizer],
};
