export default [
  {
    name: 'consumer-wordpress-vite-extension',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'consumer-contract-marker.txt',
        source: 'WordPress consumer extension loaded\n',
      });
    },
  },
];
