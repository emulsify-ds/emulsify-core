/**
 * @file CSS asset URL relativizer plugin.
 *
 * Rewrites emitted CSS references to project assets so each stylesheet resolves
 * them correctly from wherever it ends up on disk.
 *
 * ## What the path is relative to
 *
 * By default, `dist/` is self-contained and a rewritten URL points at the asset
 * copy inside the output. With `assets.selfContainedOutput: false`,
 * `css-asset-rebase.js` supplies `publishedAssetSources`, which maps each
 * published path to where the file lives in the source tree. That indirection
 * matters for a configured `assets.roots` directory, whose real location is not
 * necessarily `assets/`.
 *
 * Two cases stay output-relative. Component CSS mirrored out of `dist/` already
 * sits at the project root, so its path within the output is the project path.
 * And a Storybook build copies every asset root into its own output and serves
 * them at `/assets`, so nothing there should reach outside that output.
 *
 * An asset with no entry in the map lives in the output. This includes every
 * project asset in the default self-contained mode and generated assets such as
 * the SVG sprite in either mode. In lean mode, a mapped Vite copy is removed
 * only after this plugin actually rewrites a CSS URL to its source location;
 * copies referenced by JavaScript or other emitted files remain available.
 *
 * Development-map caveat: Core captures the Sass/PostCSS map before this
 * plugin rewrites finalized asset URLs. Replacements preserve line structure,
 * so selectors and declarations still resolve to their authored source lines.
 * A length-changing replacement can shift later mapping columns on that same
 * generated line, including positions inside the rewritten `url()` value.
 */

import { isAbsolute, posix as pathPosix, relative, resolve } from 'path';

import { resolveAssetTail } from '../../utils/asset-roots.js';
import { replaceStylesheetUrlTokens } from '../../utils/css-urls.js';
import { toPosixPath } from '../../utils/paths.js';
import { PUBLIC_ASSET_PREFIX, splitUrlSuffix } from './asset-url-rebase.js';
import { isStorybookOutput } from './storybook-output.js';

/** Stylesheet facades Vite may retain as empty Rollup chunks. */
const STYLE_FACADE_RE =
  /\.(?:css|p?css|sss|styl|stylus|less|sass|scss)(?:$|\?)/;

/**
 * Match an emitted URL to the published path recorded by the rebase plugin.
 *
 * Root-absolute URLs name bundle paths directly. A relative emitted URL is
 * resolved from the CSS asset's bundle location. Protocol-relative URLs are
 * never project output, and an encoded or otherwise non-exact path stays in
 * the bundle rather than being guessed at.
 *
 * @param {string} urlPath - URL path without a query or fragment.
 * @param {string} cssFileName - Stylesheet path inside the bundle.
 * @param {Map<string, string>} publishedAssetSources - Recorded bundle paths.
 * @returns {string} Matching published path, or an empty string.
 */
function recordedPublishedPath(urlPath, cssFileName, publishedAssetSources) {
  if (!urlPath || urlPath.startsWith('//')) return '';

  if (urlPath.startsWith('/')) {
    const direct = urlPath.slice(1);

    return publishedAssetSources.has(direct) ? direct : '';
  }

  const relativePublished = pathPosix.normalize(
    pathPosix.join(pathPosix.dirname(cssFileName), urlPath),
  );

  return publishedAssetSources.has(relativePublished) ? relativePublished : '';
}

/**
 * Identify an empty Vite chunk whose asset metadata belongs to extracted CSS.
 *
 * Vite records CSS image dependencies on the stylesheet's empty JavaScript
 * facade as `importedAssets`. Those are not independent JavaScript consumers:
 * the emitted CSS was already rewritten above and the facade is omitted from
 * disk. Treating that metadata as a live JS reference would retain every copy.
 *
 * @param {object} output - Rollup output entry.
 * @returns {boolean} TRUE for an extracted-stylesheet facade.
 */
function isCssFacadeChunk(output) {
  return Boolean(
    output?.type === 'chunk' &&
    typeof output.code === 'string' &&
    !output.code.trim() &&
    STYLE_FACADE_RE.test(output.facadeModuleId || '') &&
    output.viteMetadata?.importedCss?.size,
  );
}

/**
 * Determine whether an emitted non-CSS file still needs a published asset.
 *
 * Rollup and Vite expose referenced assets as metadata, while scanning emitted
 * text is a conservative fallback for synthetic bundles and other output
 * plugins. A false positive only retains a redundant copy; a false negative
 * would ship a broken reference.
 *
 * @param {string} published - Asset path inside the bundle.
 * @param {object} bundle - Rollup output bundle.
 * @returns {boolean} TRUE when deletion would break another emitted file.
 */
function isReferencedOutsideCss(published, bundle) {
  for (const [fileName, output] of Object.entries(bundle)) {
    if (fileName === published) continue;

    const isCssAsset = output.type === 'asset' && fileName.endsWith('.css');
    if (!isCssAsset && !isCssFacadeChunk(output)) {
      if (output.referencedFiles?.includes?.(published)) return true;
      if (output.viteMetadata?.importedAssets?.has?.(published)) return true;
    }

    if (output.type === 'chunk') {
      if (typeof output.code === 'string' && output.code.includes(published)) {
        return true;
      }
      continue;
    }

    if (isCssAsset) {
      // String CSS assets were already processed above. If another plugin
      // emitted binary CSS, keep candidates because it could not be rewritten.
      if (typeof output.source !== 'string') return true;
      continue;
    }

    if (
      typeof output.source === 'string' &&
      output.source.includes(published)
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Confirm a bundle entry is a copied source asset, not generated output.
 *
 * @param {object} output - Rollup output entry.
 * @returns {boolean} TRUE for Vite copies with source provenance.
 */
function isCopiedAsset(output) {
  if (output?.type !== 'asset') return false;
  const originals = Array.isArray(output.originalFileNames)
    ? output.originalFileNames
    : output.originalFileName
      ? [output.originalFileName]
      : [];

  return originals.length > 0;
}

/**
 * Rewrites any `url(assets/...)` found in emitted CSS to a path relative to the
 * CSS file's location on disk.
 *
 * @param {{assetsRoot?: string, env?: object, publishedAssetSources?: Map<string, string>, removablePublishedAssets?: Set<string>}} [opts] - Plugin options.
 * @returns {import('vite').PluginOption} CSS asset URL plugin.
 */
export function cssAssetUrlRelativizer({
  assetsRoot = 'assets',
  env = {},
  publishedAssetSources = new Map(),
  removablePublishedAssets = new Set(),
} = {}) {
  const enabled = env?.projectStructure?.assetRebase !== false;
  const selfContainedOutput =
    env?.projectStructure?.selfContainedOutput !== false;
  const projectDir = env?.projectDir || process.cwd();
  const mirrorComponentOutput = Boolean(
    env?.projectStructure?.mirrorComponentOutput,
  );

  let outDirFromProject = 'dist';
  let ownsOutput = true;
  let copiedPublicDir = '';

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

      const publicDir = config?.publicDir;
      copiedPublicDir =
        config?.build?.copyPublicDir !== false &&
        typeof publicDir === 'string' &&
        publicDir
          ? isAbsolute(publicDir)
            ? publicDir
            : resolve(projectDir, publicDir)
          : '';
    },

    generateBundle(_, bundle) {
      if (!enabled) return;

      const rewrittenPublishedAssets = new Set();
      const publicAssetCopies = new Map();

      const hasPublicAssetCopy = (published) => {
        if (!copiedPublicDir) return false;
        if (!publicAssetCopies.has(published)) {
          publicAssetCopies.set(
            published,
            resolveAssetTail(published, [copiedPublicDir]).status ===
              'resolved',
          );
        }

        return publicAssetCopies.get(published);
      };

      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (chunk.type !== 'asset') continue;
        if (!fileName.endsWith('.css')) continue;
        if (typeof chunk.source !== 'string') continue;

        const fromDir = stylesheetDirectory(fileName);

        // Length-changing rewrite: read the development-map caveat in the file
        // header before changing how or where this transform runs.
        chunk.source = replaceStylesheetUrlTokens(
          chunk.source,
          ({ match, quote, value }) => {
            const { path: urlPath, suffix } = splitUrlSuffix(value);
            const absolutePrefix = `/${PUBLIC_ASSET_PREFIX}/`;
            const barePrefix = `${PUBLIC_ASSET_PREFIX}/`;
            const rest = urlPath.startsWith(absolutePrefix)
              ? urlPath.slice(absolutePrefix.length)
              : urlPath.startsWith(barePrefix)
                ? urlPath.slice(barePrefix.length)
                : '';
            // `/assets/...` remains the public alias and honors a customized
            // output-side root. Other Vite-resolved URLs name their recorded
            // bundle path directly, such as `/src/assets/...`.
            const published = rest
              ? pathPosix.join(assetsRoot, rest)
              : recordedPublishedPath(urlPath, fileName, publishedAssetSources);

            if (!published) return match;

            // Only rewrite toward a target something actually put there. The
            // rebase plugin emits nothing for an `ambiguous` or `missing` URL,
            // so rewriting those would invent a confident path into the output
            // that no file occupies — turning a reported problem into a broken
            // URL that survives a green build. Leaving the authored URL alone
            // keeps the reporter's diagnostic the only account of it.
            //
            // Restricted to `ownsOutput`: a Storybook build also copies every
            // static directory beside its bundle, so there the bundle is not
            // the whole truth about what the output contains.
            if (
              ownsOutput &&
              !Object.hasOwn(bundle, published) &&
              !publishedAssetSources.has(published) &&
              !hasPublicAssetCopy(published)
            ) {
              return match;
            }

            // A copied or generated asset is reached inside the output. In lean
            // mode, a mapped project asset is reached where it lives in source.
            // Both targets are project-relative so the same subtraction works.
            const inOutput = ownsOutput
              ? pathPosix.join(outDirFromProject, published)
              : published;
            const target = publishedAssetSources.get(published) || inOutput;
            const rel = pathPosix.relative(fromDir, target);

            if (removablePublishedAssets.has(published)) {
              rewrittenPublishedAssets.add(published);
            }

            return `url(${quote}${rel}${suffix}${quote})`;
          },
        );
      }

      if (!ownsOutput || selfContainedOutput) return;

      for (const published of rewrittenPublishedAssets) {
        if (!removablePublishedAssets.has(published)) continue;

        const output = bundle[published];
        if (!isCopiedAsset(output)) continue;
        if (isReferencedOutsideCss(published, bundle)) continue;

        delete bundle[published];
      }
    },
  };
}
