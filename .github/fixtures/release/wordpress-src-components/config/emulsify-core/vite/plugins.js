module.exports = [
  {
    name: 'wordpress-fixture-vite-extension',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'extension-marker.txt',
        source: 'wordpress fixture Vite extension loaded\n',
      });
    },
  },
];
