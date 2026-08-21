/**
 * @file CSS asset URL rebase plugin.
 *
 * Repairs CSS `url()` references to project assets that Vite could not resolve.
 * By default, repaired assets are emitted into the self-contained build output;
 * projects that deploy the whole theme can opt into lean output that references
 * the source asset tree instead. See `asset-url-rebase.js` for the repair rules;
 * this module is the Vite wiring.
 *
 * ## Why this runs in a normal-order `transform`
 *
 * The rewrite has to happen where the importing stylesheet is known, which
 * rules out `generateBundle`. It also has to see Sass partials, which rules out
 * `enforce: 'pre'`: `@use`d partials are loaded inside Dart Sass through Vite's
 * own importer, never enter the module graph, and reach no plugin hook. A
 * normal-order `transform` runs after `vite:css` has compiled Sass and
 * attempted URL resolution, so it sees compiled CSS with every partial inlined
 * and every interpolation expanded.
 *
 * That ordering also makes the plugin non-destructive by construction: a
 * resolved URL is already a `__VITE_ASSET__` placeholder by this point, so the
 * only literals left are ones Vite gave up on. Nothing that works today can be
 * displaced.
 *
 * ## Self-contained and lean output
 *
 * The default keeps `dist/` deployable on its own. Vite already copies assets it
 * resolves, while this plugin explicitly emits assets for the URL forms Vite
 * could not resolve. In both cases the relativizer points CSS at the output copy.
 *
 * With `assets.selfContainedOutput: false`, each source path is instead recorded
 * in `publishedAssetSources`, keyed by the path the output copy would have had.
 * Vite copies are removed and `css-asset-relativizer.js` points URLs at the
 * source tree. This matters for configured `assets.roots`, whose real location
 * is not necessarily `assets/`.
 */

import { readFileSync } from 'fs';
import { relative } from 'path';

import { resolveAssetRoots } from '../../utils/asset-roots.js';
import { toPosixPath } from '../../utils/paths.js';
import { rewriteStylesheetUrls } from './asset-url-rebase.js';
import { isStorybookOutput } from './storybook-output.js';

/** Stylesheet requests this plugin inspects. */
const STYLE_REQUEST_RE = /\.(css|p?css|sss|styl|stylus|less|sass|scss)(?:$|\?)/;

/** Query suffixes that are not stylesheet content. */
const NON_STYLE_QUERY_RE = /[?&](raw|url)(?:&|$)/;

/**
 * Strip the Vite request query from a module id.
 *
 * @param {string} id - Module id.
 * @returns {string} Filesystem path.
 */
function stripRequestQuery(id) {
  const index = id.indexOf('?');
  return index === -1 ? id : id.slice(0, index);
}

/**
 * Determine whether an emitted asset is a copy of a project asset root file.
 *
 * Rollup records the source path an asset came from in `originalFileNames`.
 * Anything the build generated — the SVG sprite, a JS chunk — has none, so this
 * never mistakes generated output for a copy.
 *
 * @param {object} chunk - Emitted bundle entry.
 * @param {string[]} assetRootPrefixes - Project-relative asset root prefixes.
 * @returns {string} Project-relative source path, or an empty string.
 */
function copiedAssetSource(chunk, assetRootPrefixes) {
  const original = Array.isArray(chunk.originalFileNames)
    ? chunk.originalFileNames[0]
    : chunk.originalFileName;
  if (!original) return '';

  const source = toPosixPath(original).replace(/^\.?\//, '');

  return assetRootPrefixes.some((prefix) => source.startsWith(prefix))
    ? source
    : '';
}

/**
 * Rebase unresolvable CSS asset URLs and manage their output target.
 *
 * @param {{env?: object, diagnostics?: object, publishedAssetSources?: Map<string, string>}} [opts={}] - Plugin options.
 * @returns {import('vite').PluginOption} Rebase plugin.
 */
export function cssAssetRebasePlugin({
  env = {},
  diagnostics,
  publishedAssetSources = new Map(),
} = {}) {
  const enabled = env?.projectStructure?.assetRebase !== false;
  const selfContainedOutput =
    env?.projectStructure?.selfContainedOutput !== false;
  const projectDir = env?.projectDir || process.cwd();
  const emittedAssetFileNames = new Set();

  /** @type {string[]} */
  let roots = [];
  /** @type {string[]} */
  let assetRootPrefixes = [];
  let ownsOutput = true;

  return {
    name: 'emulsify-css-asset-rebase',

    configResolved(config) {
      roots = resolveAssetRoots(env);
      assetRootPrefixes = roots
        .map((root) => `${toPosixPath(relative(projectDir, root))}/`)
        .filter((prefix) => prefix !== '/' && !prefix.startsWith('..'));

      // Storybook serves every asset root at `/assets` through staticDirs and
      // copies them into its own output, so this plugin never owns that output.
      ownsOutput = !isStorybookOutput(config);
    },

    // Watch rebuilds must not inherit stale publication or emission state.
    buildStart() {
      publishedAssetSources.clear();
      emittedAssetFileNames.clear();
    },

    transform(code, id) {
      if (!enabled || !roots.length) return null;
      if (!STYLE_REQUEST_RE.test(id) || NON_STYLE_QUERY_RE.test(id)) {
        return null;
      }
      if (!code.includes('url(')) return null;

      const importer = stripRequestQuery(id);

      const { code: next, changed } = rewriteStylesheetUrls(
        code,
        importer,
        roots,
        (plan) => {
          if (plan.status === 'rebased' || plan.status === 'publish') {
            if (ownsOutput) {
              if (selfContainedOutput) {
                const fileName = plan.emitAs.replace(/^\/+/, '');

                if (!emittedAssetFileNames.has(fileName)) {
                  this.emitFile({
                    type: 'asset',
                    fileName,
                    source: readFileSync(plan.file),
                  });
                  emittedAssetFileNames.add(fileName);
                }
              } else {
                publishedAssetSources.set(
                  plan.emitAs,
                  toPosixPath(relative(projectDir, plan.file)),
                );
              }
            }
            // Static assets are outside Rollup's module graph, so a swapped
            // image would otherwise go unnoticed until an unrelated rebuild.
            this.addWatchFile(plan.file);
          }

          // `missing` is deliberately not recorded: Vite already warned about
          // that exact URL and the reporter's logger captures it. Recording it
          // again would double the occurrence count.
          if (plan.status === 'rebased' || plan.status === 'ambiguous') {
            diagnostics?.recordAssetRebase?.({
              status: plan.status,
              url: plan.originalUrl,
              rewritten: plan.url,
              importer,
              resolvedAsset: plan.file,
              candidates: plan.candidates,
            });
          }
        },
      );

      if (!changed) return null;

      // Extracted CSS carries no sourcemap in this pipeline (see the header of
      // css-asset-relativizer.js), and this is the map Vite itself returns when
      // CSS sourcemaps are off. Returning it keeps Rollup from warning.
      return { code: next, map: { mappings: '' } };
    },

    // Lean output removes Vite's copies before the relativizer consumes the
    // source map. Self-contained output keeps those copies and an empty map.
    generateBundle(_, bundle) {
      if (!enabled || !ownsOutput || selfContainedOutput) return;

      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (chunk.type !== 'asset' || fileName.endsWith('.css')) continue;

        const source = copiedAssetSource(chunk, assetRootPrefixes);
        if (!source) continue;

        publishedAssetSources.set(fileName, source);
        delete bundle[fileName];
      }
    },
  };
}
