/**
 * @file Runtime Twig template resolver used by Storybook Twig helpers.
 */

import {
  modules as twigModules,
  sources as twigSources,
} from 'virtual:emulsify-twig-globs';
import {
  buildTwigRootRecords,
  candidateKeysForReference,
} from './reference-paths.js';

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
 * Build grouped component fallback suffixes from exact candidate keys.
 *
 * Projects can keep components under grouping directories such as
 * `src/components/ui/heading/heading.twig`, while project-scoped component IDs
 * use only the component name, such as `project:heading`. Exact candidates
 * remain preferred; these suffixes only run after direct lookup misses.
 *
 * @param {string[]} candidates - Exact candidate Vite glob keys.
 * @param {object} env - Normalized Emulsify environment.
 * @returns {{rootRel: string, suffix: string}[]} Root-scoped fallback suffixes.
 */
function groupedComponentSuffixes(candidates, env) {
  const roots = buildTwigRootRecords(env)
    .map((root) => root.rootRel)
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);
  const suffixes = [];
  const seen = new Set();

  for (const candidate of candidates) {
    for (const rootRel of roots) {
      const normalizedRoot = rootRel.replace(/\/+$/, '');
      const prefix = `${normalizedRoot}/`;
      if (!candidate.startsWith(prefix)) continue;

      const suffix = candidate.slice(normalizedRoot.length);
      const key = `${normalizedRoot}|${suffix}`;
      if (!seen.has(key)) {
        suffixes.push({ rootRel: normalizedRoot, suffix });
        seen.add(key);
      }
      break;
    }
  }

  return suffixes;
}

/**
 * Resolve a Twig glob entry by grouped component suffix.
 *
 * @param {Record<string, *>} map - Vite glob map.
 * @param {string[]} candidates - Exact candidate Vite glob keys.
 * @param {object} env - Normalized Emulsify environment.
 * @returns {{key: string, value: *}|undefined} Matched glob entry.
 */
function findGroupedComponentEntry(map, candidates, env) {
  const entries = Object.entries(map);

  for (const { rootRel, suffix } of groupedComponentSuffixes(candidates, env)) {
    const rootPrefix = `${rootRel}/`;
    const match = entries.find(
      ([key]) => key.startsWith(rootPrefix) && key.endsWith(suffix),
    );
    if (match) {
      return { key: match[0], value: match[1] };
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
 * Find a direct or grouped component Vite glob entry.
 *
 * @param {Record<string, *>} map - Vite glob map.
 * @param {string[]} candidates - Exact candidate Vite glob keys.
 * @param {object} env - Normalized Emulsify environment.
 * @returns {{key: string, value: *}|undefined} Matched glob entry.
 */
function findTemplateEntry(map, candidates, env) {
  return (
    findGlobEntry(map, candidates) ||
    findGroupedComponentEntry(map, candidates, env)
  );
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

  const findSourceEntry = (name) => {
    const candidates = candidateKeysForReference(name, env);

    return (
      findGlobEntry(sources, [name]) ||
      findTemplateEntry(sources, candidates, env)
    );
  };

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

      const groupedEntry = findGroupedComponentEntry(modules, candidates, env);
      if (groupedEntry) {
        return groupedEntry.value.default ?? groupedEntry.value;
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

let defaultResolver;

/**
 * Lazily create the default resolver after virtual Twig glob bindings settle.
 *
 * The virtual Twig glob module eagerly imports compiled Twig modules. Those
 * modules register source(), which imports this resolver while the virtual glob
 * module may still be initializing. Deferring the default resolver avoids
 * reading virtual module bindings during that circular module setup.
 *
 * @returns {ReturnType<typeof createTwigResolver>} Default Twig resolver.
 */
function getDefaultResolver() {
  if (!defaultResolver) {
    defaultResolver = createTwigResolver();
  }

  return defaultResolver;
}

/**
 * Resolve a template identifier to a compiled Twig render function.
 *
 * @param {string} name - Template identifier.
 * @returns {Function|undefined} Render function when available.
 */
export default function resolveTemplate(name) {
  return getDefaultResolver().resolveTemplate(name);
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
  return getDefaultResolver().resolveTemplateSource(name);
}

resolveTemplateSource.isTemplateSourceLoading = (name) =>
  getDefaultResolver().isTemplateSourceLoading(name);

resolveTemplateSource.whenTemplateSourceLoaded = (name) =>
  getDefaultResolver().whenTemplateSourceLoaded(name);
