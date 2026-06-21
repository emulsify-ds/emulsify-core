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
