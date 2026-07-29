export default [
  {
    name: 'consumer-none-vite-extension',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'consumer-contract-marker.txt',
        source: 'platform-none consumer extension loaded\n',
      });
    },
  },
];
