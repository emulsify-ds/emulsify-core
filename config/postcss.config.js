/**
 * @file PostCSS plugin configuration.
 */

import autoPrefixer from 'autoprefixer';

export default {
  // Autoprefixer keeps compiled CSS compatible with supported browsers.
  plugins: [autoPrefixer()],
};
