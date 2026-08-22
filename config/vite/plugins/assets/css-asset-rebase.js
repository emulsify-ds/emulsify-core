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
 * That ordering also keeps ordinary URLs non-destructive: a resolved URL is
 * already a `__VITE_ASSET__` placeholder by this point, so the only literals
 * left are ones Vite gave up on. The reserved `@assets/...` namespace is the
 * deliberate exception; the resolver bridge below prevents consumer aliases,
 * packages, and same-named directories from claiming it first.
 *
 * ## Self-contained and lean output
 *
 * The default keeps `dist/` deployable on its own. Vite already copies assets it
 * resolves, while this plugin explicitly emits assets for the URL forms Vite
 * could not resolve. In both cases the relativizer points CSS at the output copy.
 *
 * With `assets.selfContainedOutput: false`, each source path is instead recorded
 * in `publishedAssetSources`, keyed by the path the output copy would have had.
 * `css-asset-relativizer.js` points CSS URLs at the source tree and removes a
 * Vite copy only after that rewrite actually happens. Copies still referenced
 * by JavaScript or another emitted file remain in the output. This matters for
 * configured `assets.roots`, whose real location is not necessarily `assets/`.
 */

import { readFileSync } from 'fs';
import { relative } from 'path';

import { resolveAssetRoots } from '../../utils/asset-roots.js';
import { toPosixPath } from '../../utils/paths.js';
import {
  ASSET_ALIAS_PREFIX,
  rewriteStylesheetUrls,
} from './asset-url-rebase.js';
import { isStorybookOutput } from './storybook-output.js';

/** Stylesheet requests this plugin inspects. */
const STYLE_REQUEST_RE = /\.(css|p?css|sss|styl|stylus|less|sass|scss)(?:$|\?)/;

/** Query suffixes that are not stylesheet content. */
const NON_STYLE_QUERY_RE = /[?&](raw|url)(?:&|$)/;

/** Case-insensitive CSS URL function marker. */
const URL_FUNCTION_RE = /url\(/i;

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
 * Match the reserved alias at the start of a URL or after the relative path
 * Sass inserts when rebasing an imported partial. The captured prefix is put
 * back unchanged by the alias entry below.
 *
 * @type {RegExp}
 */
const ASSET_ALIAS_RESOLUTION_RE = new RegExp(
  `^(?!/)((?:[^?#]*/)?)(?=${ASSET_ALIAS_PREFIX}/)`,
);

/**
 * Stop Vite's private CSS resolver after it recognizes the Core alias.
 *
 * Vite's CSS resolver does not call user `resolveId` hooks. A truthy result
 * with an empty id makes its isolated alias container stop without resolving a
 * project alias, package, or same-named directory. Vite then leaves the URL for
 * this plugin's normal-order transform, which preserves Core's configured-root
 * resolution, diagnostics, and deterministic output paths.
 *
 * @returns {{id: string}} Empty resolution veto.
 */
const reserveAssetAlias = () => ({ id: '' });

/**
 * Install the resolver veto after Vite has normalized config.
 *
 * Late installation is intentional: Vite warns about alias custom resolvers
 * while normalizing config, but creates its private CSS resolver lazily on the
 * first stylesheet transform. Its normal module alias plugin has already
 * captured consumer entries, so ordinary JavaScript imports keep their
 * existing behavior. A custom resolver created after this hook sees `@assets`
 * as reserved too; projects must not use that stylesheet namespace as a
 * package alias.
 *
 * This bridge intentionally targets Vite 8, which Core pins in package.json.
 * Vite 9 removes alias custom resolvers, so a Vite-major upgrade must replace
 * this bridge; the conflicting-alias release fixture is the fail-loud contract
 * test for that upgrade.
 *
 * @param {import('vite').ResolvedConfig|object} config - Resolved Vite config.
 * @returns {void}
 */
function reserveAssetAliasForCss(config) {
  const aliasLists = new Set([
    config?.resolve?.alias,
    ...Object.values(config?.environments || {}).map(
      (environment) => environment?.resolve?.alias,
    ),
  ]);

  for (const aliases of aliasLists) {
    if (!Array.isArray(aliases)) continue;
    if (aliases.some((entry) => entry?.customResolver === reserveAssetAlias)) {
      continue;
    }

    aliases.unshift({
      find: ASSET_ALIAS_RESOLUTION_RE,
      replacement: '$1',
      customResolver: reserveAssetAlias,
    });
  }
}

/**
 * Rebase unresolvable CSS asset URLs and manage their output target.
 *
 * @param {{env?: object, diagnostics?: object, publishedAssetSources?: Map<string, string>, removablePublishedAssets?: Set<string>}} [opts={}] - Plugin options.
 * @returns {import('vite').PluginOption} Rebase plugin.
 */
export function cssAssetRebasePlugin({
  env = {},
  diagnostics,
  publishedAssetSources = new Map(),
  removablePublishedAssets = new Set(),
} = {}) {
  const enabled = env?.projectStructure?.assetRebase !== false;
  const selfContainedOutput =
    env?.projectStructure?.selfContainedOutput !== false;
  const projectDir = env?.projectDir || process.cwd();
  /** @type {Map<string, string>} Published path -> absolute source file. */
  const pendingAssetEmissions = new Map();

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

      if (enabled) reserveAssetAliasForCss(config);
    },

    // Watch rebuilds must not inherit stale publication or emission state.
    buildStart() {
      publishedAssetSources.clear();
      removablePublishedAssets.clear();
      pendingAssetEmissions.clear();
    },

    transform(code, id) {
      if (!enabled || !roots.length) return null;
      if (!STYLE_REQUEST_RE.test(id) || NON_STYLE_QUERY_RE.test(id)) {
        return null;
      }
      if (!URL_FUNCTION_RE.test(code)) return null;

      const importer = stripRequestQuery(id);

      const { code: next, changed } = rewriteStylesheetUrls(
        code,
        importer,
        roots,
        (plan) => {
          if (
            plan.status === 'aliased' ||
            plan.status === 'rebased' ||
            plan.status === 'publish'
          ) {
            if (ownsOutput) {
              if (selfContainedOutput) {
                const fileName = plan.emitAs.replace(/^\/+/, '');
                pendingAssetEmissions.set(fileName, plan.file);
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
          if (
            plan.status === 'aliased' ||
            plan.status === 'rebased' ||
            plan.status === 'ambiguous'
          ) {
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

    // Lean output records every Vite copy the relativizer may redirect. The
    // relativizer owns deletion because only an actual CSS rewrite proves the
    // copy is redundant; JS-only and generated assets must survive.
    generateBundle(_, bundle) {
      if (!enabled || !ownsOutput) return;

      if (selfContainedOutput) {
        // Vite may already have emitted this exact published path for an
        // equivalent `/assets/...` CSS reference or a JavaScript import. Wait
        // until the bundle is known so Core can fill only the missing paths;
        // emitting eagerly from `transform` produces FILE_NAME_CONFLICT noise
        // for the same file under the two accepted stylesheet spellings.
        for (const [fileName, file] of pendingAssetEmissions) {
          if (Object.hasOwn(bundle, fileName)) continue;

          this.emitFile({
            type: 'asset',
            fileName,
            source: readFileSync(file),
          });
        }
        return;
      }

      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (chunk.type !== 'asset' || fileName.endsWith('.css')) continue;

        const source = copiedAssetSource(chunk, assetRootPrefixes);
        if (!source) continue;

        publishedAssetSources.set(fileName, source);
        removablePublishedAssets.add(fileName);
      }
    },
  };
}
