/**
 * @file CSS asset URL relativizer plugin.
 *
 * Rewrites emitted CSS references to project assets so each stylesheet resolves
 * them correctly from wherever it ends up on disk.
 *
 * ## What the path is relative to
 *
 * `dist/` holds build output; a theme's `assets/` directory is source, already
 * web-served from the theme root. So a rewritten URL points at the source
 * directory rather than at a copy inside the output — `dist/components/card/
 * css/card.css` reaches `assets/images/x.jpg` by climbing four levels, not
 * three. `css-asset-rebase.js` supplies `publishedAssetSources`, which maps the
 * published path of each asset to where the file actually lives relative to the
 * project root. That indirection matters for a configured `assets.roots`
 * directory, whose real location is not `assets/` at all.
 *
 * Two cases stay output-relative. Component CSS mirrored out of `dist/` already
 * sits at the project root, so its path within the output is the project path.
 * And a Storybook build copies every asset root into its own output and serves
 * them at `/assets`, so nothing there should reach outside that output.
 *
 * An asset with no entry in the map — the generated SVG sprite, most notably —
 * really does live in the output, and keeps an output-relative path.
 *
 * Sourcemap warning: this rewrites emitted CSS in `generateBundle` without
 * adjusting positions, and every replacement changes the length of the line it
 * sits on. Vite does not emit sourcemaps for extracted CSS today, so there is
 * nothing to invalidate. If CSS sourcemaps are ever added, this plugin has to
 * shift mappings as it rewrites (for example via MagicString) or each mapping
 * after the first rewritten `url()` will silently resolve to the wrong column.
 */

import { isAbsolute, posix as pathPosix, relative, resolve } from 'path';

import { toPosixPath } from '../../utils/paths.js';
import { isStorybookOutput } from './storybook-output.js';

/**
 * Rewrites any `url(assets/...)` found in emitted CSS to a path relative to the
 * CSS file's location on disk.
 *
 * @param {{assetsRoot?: string, env?: object, publishedAssetSources?: Map<string, string>}} [opts] - Plugin options.
 * @returns {import('vite').PluginOption} CSS asset URL plugin.
 */
export function cssAssetUrlRelativizer({
  assetsRoot = 'assets',
  env = {},
  publishedAssetSources = new Map(),
} = {}) {
  const projectDir = env?.projectDir || process.cwd();
  const mirrorComponentOutput = Boolean(
    env?.projectStructure?.mirrorComponentOutput,
  );

  let outDirFromProject = 'dist';
  let ownsOutput = true;

  /**
   * Resolve the directory an emitted stylesheet occupies, project-relative.
   *
   * @param {string} fileName - Emitted CSS path within the output directory.
   * @returns {string} Directory the URL resolves from.
   */
  const stylesheetDirectory = (fileName) => {
    const withinOutput = pathPosix.dirname(fileName);

    // Storybook output is self-contained, and mirrored component CSS is moved
    // out of the output directory to the project root; in both cases the path
    // within the output is already the right base.
    if (!ownsOutput) return withinOutput;
    if (mirrorComponentOutput && fileName.startsWith('components/')) {
      return withinOutput;
    }

    return pathPosix.join(outDirFromProject, withinOutput);
  };

  return {
    name: 'emulsify-css-asset-url-relativizer',
    apply: 'build',

    configResolved(config) {
      // Vite resolves `outDir` against the project root before handing it over,
      // but accept a relative value too so the plugin is testable in isolation.
      const outDir = config?.build?.outDir || 'dist';
      const absoluteOutDir = isAbsolute(outDir)
        ? outDir
        : resolve(projectDir, outDir);

      outDirFromProject = toPosixPath(relative(projectDir, absoluteOutDir));
      ownsOutput = !isStorybookOutput(config);
    },

    generateBundle(_, bundle) {
      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (chunk.type !== 'asset') continue;
        if (!fileName.endsWith('.css')) continue;
        if (typeof chunk.source !== 'string') continue;

        const fromDir = stylesheetDirectory(fileName);

        // Length-changing rewrite: read the sourcemap warning in the file
        // header before pairing this plugin with CSS sourcemaps.
        chunk.source = chunk.source.replace(
          /url\((['"]?)\/?assets\/([^)'"]+)\1\)/g,
          (match, quote = '', rest) => {
            const published = pathPosix.join(assetsRoot, rest);
            // An asset the build kept in its output — the SVG sprite — is
            // reached inside the output directory. One left in the source tree
            // is reached where it actually lives. Both are expressed relative
            // to the project root so the same subtraction works for either.
            const inOutput = ownsOutput
              ? pathPosix.join(outDirFromProject, published)
              : published;
            const target = publishedAssetSources.get(published) || inOutput;
            const rel = pathPosix.relative(fromDir, target);

            return `url(${quote}${rel}${quote})`;
          },
        );
      }
    },
  };
}
