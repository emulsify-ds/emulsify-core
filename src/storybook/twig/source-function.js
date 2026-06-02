/**
 * @file Twig source() function factory shared by Storybook Twig renderers.
 */

import {
  coversAssetPath,
  getAssetText,
  isAssetTextLoading,
  whenAssetTextLoaded,
} from 'virtual:emulsify-twig-asset-sources';
import { IMAGE_ASSET_EXTS, INLINE_ASSET_EXTS } from './source-extensions.js';
import { TWIG_SOURCE_LOADED_EVENT } from './source-events.js';

const DEFAULT_ENV =
  (typeof __EMULSIFY_ENV__ !== 'undefined' && __EMULSIFY_ENV__) || {};
const missingTemplateSourceResolver = () => undefined;

function getRuntimeEnv() {
  return globalThis.__EMULSIFY_ENV__ || DEFAULT_ENV;
}

// GitHub Pages serves static assets from a repository-prefixed base path.
const PUBLIC_ASSET_BASE =
  typeof window !== 'undefined' &&
  window.location &&
  window.location.hostname &&
  window.location.hostname.endsWith('github.io')
    ? `/${getRuntimeEnv().machineName || ''}/assets/`
    : '/assets/';

const pendingSourceLoads = new Set();
const warnedAssetSources = new Set();

function allowSyncXhrSource() {
  const adapter = getRuntimeEnv().platformAdapter || {};
  return Boolean(
    adapter.storybook?.allowSyncXhrSource || adapter.allowSyncXhrSource,
  );
}

/**
 * Normalize an `@assets` reference to a public asset path.
 *
 * @param {string} assetPath - Twig asset reference.
 * @returns {string} Asset path below the public asset base.
 */
function normalizeAssetPath(assetPath) {
  return assetPath.replace(/^@assets\//, '').replace(/^assets\//, '');
}

/**
 * Read a text asset from Storybook's static server.
 *
 * @param {string} relPath - Public asset path below `/assets`.
 * @returns {string|undefined} Fetched text when available.
 */
function fetchTextAsset(relPath) {
  try {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', `${PUBLIC_ASSET_BASE}${relPath}`, false);
    xhr.send(null);
    if (xhr.status >= 200 && xhr.status < 300) {
      return xhr.responseText;
    }

    console.error(`source(): ${xhr.status} while fetching ${relPath}`);
  } catch (error) {
    console.error(`source(): failed to fetch ${relPath}`, error);
  }

  return undefined;
}

/**
 * Warn once when a text asset cannot use the lazy virtual source map.
 *
 * @param {string} relPath - Public asset path below `/assets`.
 * @param {string} reason - Short explanation of the missing source.
 */
function warnTextAssetSource(relPath, reason) {
  if (warnedAssetSources.has(relPath)) {
    return;
  }

  warnedAssetSources.add(relPath);
  console.warn(
    `source(): ${reason} for @assets/${relPath}. Synchronous XHR fallback is disabled by default because it blocks Storybook rendering. Move the asset under a configured asset root such as src/assets or assets, or temporarily enable platformAdapter.storybook.allowSyncXhrSource. The sync-XHR fallback is deprecated and will be removed in 4.2.`,
  );
}

/**
 * Notify Storybook renderers when any lazy source import is available.
 *
 * @param {Promise} sourceLoad - Lazy source import promise.
 * @param {object} detail - Event detail payload.
 */
function scheduleSourceLoadedEvent(sourceLoad, detail) {
  if (!sourceLoad || typeof sourceLoad.then !== 'function') {
    return;
  }
  if (pendingSourceLoads.has(sourceLoad)) {
    return;
  }

  pendingSourceLoads.add(sourceLoad);
  sourceLoad
    .then((sourceText) => {
      if (
        typeof sourceText !== 'string' ||
        typeof window === 'undefined' ||
        typeof window.dispatchEvent !== 'function'
      ) {
        return;
      }

      window.dispatchEvent(
        new CustomEvent(TWIG_SOURCE_LOADED_EVENT, { detail }),
      );
    })
    .catch(() => {})
    .finally(() => {
      pendingSourceLoads.delete(sourceLoad);
    });
}

/**
 * Resolve an `@assets` reference for Storybook.
 *
 * @param {string} assetPath - Twig asset reference.
 * @param {{ ignoreMissing?: boolean }} [options={}] - Optional source() flags.
 * @returns {string|undefined} Raw text, image markup, URL, or undefined while lazy text loads.
 */
export function resolveAssetSource(assetPath, { ignoreMissing = false } = {}) {
  const relPath = normalizeAssetPath(assetPath);
  const extension = relPath.split('.').pop().toLowerCase();

  if (INLINE_ASSET_EXTS.has(extension)) {
    const text = getAssetText(assetPath);
    if (typeof text === 'string') {
      return text;
    }

    if (isAssetTextLoading(assetPath)) {
      scheduleSourceLoadedEvent(whenAssetTextLoaded(assetPath), {
        assetPath,
      });
      return undefined;
    }

    if (coversAssetPath(assetPath)) {
      if (!ignoreMissing) {
        warnTextAssetSource(
          relPath,
          'no build-time text asset source was found',
        );
      }
      return undefined;
    }

    if (allowSyncXhrSource()) {
      return fetchTextAsset(relPath);
    }

    if (!ignoreMissing) {
      warnTextAssetSource(
        relPath,
        'no configured build-time asset root covers',
      );
    }
    return undefined;
  }

  if (IMAGE_ASSET_EXTS.has(extension)) {
    return `<img src="${PUBLIC_ASSET_BASE}${relPath}" alt="" role="img">`;
  }

  return `${PUBLIC_ASSET_BASE}${relPath}`;
}

/**
 * Notify Storybook renderers when a lazy Twig template source import is available.
 *
 * @param {Function} templateSourceResolver - Twig template source resolver.
 * @param {string} templateName - Twig template reference.
 */
function scheduleTemplateSourceLoadedEvent(
  templateSourceResolver,
  templateName,
) {
  const sourceLoad =
    typeof templateSourceResolver.whenTemplateSourceLoaded === 'function'
      ? templateSourceResolver.whenTemplateSourceLoaded(templateName)
      : undefined;

  scheduleSourceLoadedEvent(sourceLoad, { templateName });
}

/**
 * Create a Twig.js `source()` function for Storybook rendering.
 *
 * Lazy Twig source loaders return an empty string on first render while the raw
 * source import resolves. The source text is cached by the resolver, and the
 * Storybook Twig renderer re-renders when the load completes.
 *
 * @param {Function} templateSourceResolver - Twig template source resolver.
 * @returns {Function} Twig.js function implementation.
 */
export function createTwigSourceFunction(
  templateSourceResolver = missingTemplateSourceResolver,
) {
  return function source(templateName, ignoreMissing = false) {
    if (typeof templateName !== 'string') return '';

    const templateSource = templateSourceResolver(templateName);
    if (typeof templateSource === 'string') {
      return templateSource;
    }
    if (
      typeof templateSourceResolver.isTemplateSourceLoading === 'function' &&
      templateSourceResolver.isTemplateSourceLoading(templateName)
    ) {
      scheduleTemplateSourceLoadedEvent(templateSourceResolver, templateName);
      return '';
    }

    if (
      templateName.startsWith('@assets/') ||
      templateName.startsWith('assets/')
    ) {
      return resolveAssetSource(templateName, { ignoreMissing }) || '';
    }

    if (!ignoreMissing) {
      console.error(`source(): cannot resolve ${templateName}`);
    }

    return '';
  };
}
