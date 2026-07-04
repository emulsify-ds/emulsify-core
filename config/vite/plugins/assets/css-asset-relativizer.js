/**
 * @file CSS asset URL relativizer plugin.
 *
 * Rewrites emitted CSS references to root assets so nested CSS files can keep
 * resolving copied assets correctly from their final output directories.
 */

import { posix as pathPosix } from 'path';

/**
 * Rewrites any `url(assets/...)` found in emitted CSS to a path relative to the
 * CSS file's directory.
 *
 * @param {{ assetsRoot?: string }} [opts] - Plugin options.
 * @returns {import('vite').PluginOption} CSS asset URL plugin.
 */
export function cssAssetUrlRelativizer({ assetsRoot = 'assets' } = {}) {
  return {
    name: 'emulsify-css-asset-url-relativizer',
    apply: 'build',
    generateBundle(_, bundle) {
      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (chunk.type !== 'asset') continue;
        if (!fileName.endsWith('.css')) continue;
        if (typeof chunk.source !== 'string') continue;

        const fromDir = pathPosix.dirname(fileName);

        chunk.source = chunk.source.replace(
          /url\((['"]?)\/?assets\/([^)'"]+)\1\)/g,
          (match, quote = '', rest) => {
            const target = pathPosix.join(assetsRoot, rest);
            const rel = pathPosix.relative(fromDir, target);
            return `url(${quote}${rel}${quote})`;
          },
        );
      }
    },
  };
}
