/**
 * @file Runtime Twig template resolver used by Storybook Twig helpers.
 */

import {
  modules as twigModules,
  sources as twigSources,
} from 'virtual:emulsify-twig-globs';
import { candidateKeysForReference } from './reference-paths.js';

export {
  buildTwigRootRecords,
  candidateKeysForReference,
  candidateKeysForRoot,
  toRootRelativePath,
} from './reference-paths.js';

const ENV = (typeof __EMULSIFY_ENV__ !== 'undefined' && __EMULSIFY_ENV__) || {};

/**
 * Resolve a value from a Vite glob map.
 *
 * @param {Record<string, *>} map - Vite glob map.
 * @param {string[]} candidates - Candidate map keys.
 * @returns {*} Resolved map value.
 */
function resolveFromMap(map, candidates) {
  for (const key of candidates) {
    // Vite glob map keys are generated from static Storybook patterns.
    // eslint-disable-next-line security/detect-object-injection
    const value = map[key];
    if (value) {
      return value.default ?? value;
    }
  }

  return undefined;
}

/**
 * Find a Vite glob map entry and keep its key for cache lookups.
 *
 * @param {Record<string, *>} map - Vite glob map.
 * @param {string[]} candidates - Candidate map keys.
 * @returns {{key: string, value: *}|undefined} Matched glob entry.
 */
function findGlobEntry(map, candidates) {
  for (const key of candidates) {
    if (Object.hasOwnProperty.call(map, key)) {
      // Vite glob map keys are generated from static Storybook patterns.
      // eslint-disable-next-line security/detect-object-injection
      return { key, value: map[key] };
    }
  }

  return undefined;
}

/**
 * Normalize raw source loader output from Vite import forms.
 *
 * @param {*} value - Raw source value or imported module.
 * @returns {string|undefined} Raw source text.
 */
function normalizeSourceText(value) {
  const source = value?.default ?? value;
  return typeof source === 'string' ? source : undefined;
}

/**
 * Create a Twig resolver bound to a normalized environment and Vite maps.
 *
 * @param {{
 *   env?: object,
 *   modules?: Record<string, *>,
 *   sources?: Record<string, string|Function>
 * }} options - Resolver inputs.
 * @returns {{
 *   resolveTemplate: Function,
 *   resolveTemplateSource: Function,
 *   isTemplateSourceLoading: Function,
 *   whenTemplateSourceLoaded: Function,
 *   candidateKeysForReference: Function
 * }} Resolver functions.
 */
export function createTwigResolver({
  env = ENV,
  modules = twigModules,
  sources = twigSources,
} = {}) {
  const sourceTextCache = new Map();
  const sourceLoadPromises = new Map();

  const findSourceEntry = (name) =>
    findGlobEntry(sources, [name]) ||
    findGlobEntry(sources, candidateKeysForReference(name, env));

  const resolveSourceEntry = (entry) => {
    if (!entry) return undefined;
    if (sourceTextCache.has(entry.key)) {
      return sourceTextCache.get(entry.key);
    }

    const sourceText = normalizeSourceText(entry.value);
    if (typeof sourceText === 'string') {
      sourceTextCache.set(entry.key, sourceText);
      return sourceText;
    }

    if (
      typeof entry.value === 'function' &&
      !sourceLoadPromises.has(entry.key)
    ) {
      let loadedSource;
      try {
        loadedSource = entry.value();
      } catch (error) {
        loadedSource = Promise.reject(error);
      }

      const sourceLoad = Promise.resolve(loadedSource)
        .then((loaded) => {
          const loadedText = normalizeSourceText(loaded);
          if (typeof loadedText === 'string') {
            sourceTextCache.set(entry.key, loadedText);
          }
          return loadedText;
        })
        .catch((error) => {
          console.error(`source(): failed to load ${entry.key}`, error);
          return undefined;
        })
        .finally(() => {
          sourceLoadPromises.delete(entry.key);
        });

      sourceLoadPromises.set(entry.key, sourceLoad);
    }

    return undefined;
  };

  const isTemplateSourceLoading = (name) => {
    const entry = findSourceEntry(name);
    return !!entry && sourceLoadPromises.has(entry.key);
  };

  const whenTemplateSourceLoaded = (name) => {
    const entry = findSourceEntry(name);
    return entry ? sourceLoadPromises.get(entry.key) : undefined;
  };

  return {
    candidateKeysForReference: (name) => candidateKeysForReference(name, env),
    resolveTemplate(name) {
      // Direct lookups support callers that already resolved a Vite glob key.
      // eslint-disable-next-line security/detect-object-injection
      const direct = modules[name];
      if (direct) {
        return direct.default ?? direct;
      }

      const candidates = candidateKeysForReference(name, env);
      const template = resolveFromMap(modules, candidates);
      if (template) {
        return template;
      }

      return undefined;
    },
    isTemplateSourceLoading,
    resolveTemplateSource(name) {
      return resolveSourceEntry(findSourceEntry(name));
    },
    whenTemplateSourceLoaded,
  };
}

const defaultResolver = createTwigResolver();

/**
 * Resolve a template identifier to a compiled Twig render function.
 *
 * @param {string} name - Template identifier.
 * @returns {Function|undefined} Render function when available.
 */
export default function resolveTemplate(name) {
  return defaultResolver.resolveTemplate(name);
}

/**
 * Resolve a template identifier to raw Twig source.
 *
 * Lazy raw-source glob entries return `undefined` on first request while their
 * dynamic import resolves. The loaded text is cached and returned on a later
 * call, which usually happens after the Storybook Twig renderer re-renders.
 *
 * @param {string} name - Template identifier.
 * @returns {string|undefined} Raw Twig source when available.
 */
export function resolveTemplateSource(name) {
  return defaultResolver.resolveTemplateSource(name);
}

resolveTemplateSource.isTemplateSourceLoading = (name) =>
  defaultResolver.isTemplateSourceLoading(name);

resolveTemplateSource.whenTemplateSourceLoaded = (name) =>
  defaultResolver.whenTemplateSourceLoaded(name);
