import ImageMinimizerPlugin from 'image-minimizer-webpack-plugin';
import TerserPlugin from 'terser-webpack-plugin';

// A supported custom implementation avoids jpegtran/optipng install-time binary
// downloads. Keep this function self-contained for the plugin's worker pool.
export async function minifyImages(original) {
  const isPng = /\.png$/i.test(original.filename);
  if (!isPng && !/\.jpe?g$/i.test(original.filename)) return null;

  try {
    const { compressJpeg, losslessCompressPng } =
      await import('@napi-rs/image');
    const data = isPng
      ? await losslessCompressPng(original.data, { strip: false })
      : await compressJpeg(original.data, {
          quality: 100,
          optimizeScans: true,
        });
    return {
      ...original,
      data,
      info: {
        ...original.info,
        minimized: true,
        minimizedBy: [...(original.info.minimizedBy || []), '@napi-rs/image'],
      },
    };
  } catch (error) {
    original.errors.push(error);
    return null;
  }
}

const ImageMinimizer = new ImageMinimizerPlugin({
  minimizer: {
    implementation: minifyImages,
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
