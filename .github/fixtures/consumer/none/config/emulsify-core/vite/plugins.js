import { resolve } from 'node:path';

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

// The consumer overlay replaces the release fixture's extension file, so keep
// its conflicting JavaScript alias while adding the packed-consumer marker.
export const extendConfig = () => ({
  resolve: {
    alias: {
      '@assets': resolve(import.meta.dirname, '../../../asset-shadow'),
    },
  },
});
