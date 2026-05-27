/**
 * @file Twig source() runtime helper for Storybook-rendered templates.
 */

import { resolveTemplateSource } from './resolver.js';
import { TWIG_SOURCE_LOADED_EVENT } from './source-events.js';

const ENV = (typeof __EMULSIFY_ENV__ !== 'undefined' && __EMULSIFY_ENV__) || {};

// GitHub Pages serves static assets from a repository-prefixed base path.
const PUBLIC_ASSET_BASE =
  typeof window !== 'undefined' &&
  window.location &&
  window.location.hostname &&
  window.location.hostname.endsWith('github.io')
    ? `/${ENV.machineName || ''}/assets/`
    : '/assets/';

// Text assets can be safely inlined; binary assets should remain URL-based.
const INLINE_ASSET_EXTS = new Set([
  'svg',
  'html',
  'twig',
  'css',
  'js',
  'json',
  'txt',
  'md',
]);
const IMAGE_ASSET_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif']);
const pendingSourceLoads = new Set();

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
 * Resolve an `@assets` reference for Storybook.
 *
 * @param {string} assetPath - Twig asset reference.
 * @returns {string} Raw text, image markup, or URL.
 */
export function resolveAssetSource(assetPath) {
  const relPath = normalizeAssetPath(assetPath);
  const extension = relPath.split('.').pop().toLowerCase();

  if (INLINE_ASSET_EXTS.has(extension)) {
    const text = fetchTextAsset(relPath);
    if (typeof text === 'string') {
      return text;
    }
  }

  if (IMAGE_ASSET_EXTS.has(extension)) {
    return `<img src="${PUBLIC_ASSET_BASE}${relPath}" alt="" role="img">`;
  }

  return `${PUBLIC_ASSET_BASE}${relPath}`;
}

/**
 * Notify Storybook renderers when a lazy Twig source import is available.
 *
 * @param {Function} templateSourceResolver - Twig template source resolver.
 * @param {string} templateName - Twig template reference.
 */
function scheduleSourceLoadedEvent(templateSourceResolver, templateName) {
  const sourceLoad =
    typeof templateSourceResolver.whenTemplateSourceLoaded === 'function'
      ? templateSourceResolver.whenTemplateSourceLoaded(templateName)
      : undefined;

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
        new CustomEvent(TWIG_SOURCE_LOADED_EVENT, {
          detail: { templateName },
        }),
      );
    })
    .catch(() => {})
    .finally(() => {
      pendingSourceLoads.delete(sourceLoad);
    });
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
  templateSourceResolver = resolveTemplateSource,
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
      scheduleSourceLoadedEvent(templateSourceResolver, templateName);
      return '';
    }

    if (
      templateName.startsWith('@assets/') ||
      templateName.startsWith('assets/')
    ) {
      return resolveAssetSource(templateName);
    }

    if (!ignoreMissing) {
      console.error(`source(): cannot resolve ${templateName}`);
    }

    return '';
  };
}

/**
 * Twig `source()` runtime helper.
 *
 * @param {Object} Twig - Twig.js module.
 * @returns {undefined}
 */
function twigSource(Twig) {
  Twig.extendFunction('source', createTwigSourceFunction());
}

export default twigSource;
