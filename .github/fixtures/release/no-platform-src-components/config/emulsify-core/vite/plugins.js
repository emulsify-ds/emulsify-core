const { resolve } = require('node:path');

module.exports = [
  {
    name: 'no-platform-fixture-vite-extension',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'extension-marker.txt',
        source: 'config/emulsify-core/vite/plugins.js loaded\n',
      });
    },
  },
];

// Deliberately tries to steal Core's CSS-only namespace. The release fixture
// proves @assets remains bound to configured project asset roots.
module.exports.extendConfig = () => ({
  resolve: {
    alias: {
      '@assets': resolve(__dirname, '../../../asset-shadow'),
    },
  },
});
