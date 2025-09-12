import ImageMinimizerPlugin from 'image-minimizer-webpack-plugin';
import TerserPlugin from 'terser-webpack-plugin';

const ImageMinimizer = new ImageMinimizerPlugin({
  minimizer: {
    implementation: ImageMinimizerPlugin.imageminMinify,
    options: {
      plugins: [
        ['jpegtran', { progressive: true }],
        ['optipng', { optimizationLevel: 5 }],
      ],
    },
  },
});

const TerserMinimizer = new TerserPlugin({
  terserOptions: {
    mangle: {
      reserved: ['Drupal', 'drupalSettings', 'once'],
    },
  },
});

export default {
  minimizer: [ImageMinimizer, TerserMinimizer],
};
