import ImageMinimizerPlugin from 'image-minimizer-webpack-plugin';

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

export default {
  minimizer: [ImageMinimizer],
};
