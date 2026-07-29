/**
 * @file CSS asset URL relativizer plugin.
 *
 * Rewrites emitted CSS references to root assets so nested CSS files can keep
 * resolving copied assets correctly from their final output directories.
 *
 * Sourcemap warning: this rewrites emitted CSS in `generateBundle` without
 * adjusting positions, and every replacement changes the length of the line it
 * sits on. Vite does not emit sourcemaps for extracted CSS today, so there is
 * nothing to invalidate. If CSS sourcemaps are ever added, this plugin has to
 * shift mappings as it rewrites (for example via MagicString) or each mapping
 * after the first rewritten `url()` will silently resolve to the wrong column.
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

        // Length-changing rewrite: read the sourcemap warning in the file
        // header before pairing this plugin with CSS sourcemaps.
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
