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
 * Create a Twig resolver bound to a normalized environment and Vite maps.
 *
 * @param {{
 *   env?: object,
 *   modules?: Record<string, *>,
 *   sources?: Record<string, string>
 * }} options - Resolver inputs.
 * @returns {{resolveTemplate: Function, resolveTemplateSource: Function, candidateKeysForReference: Function}}
 *   Resolver functions.
 */
export function createTwigResolver({
  env = ENV,
  modules = twigModules,
  sources = twigSources,
} = {}) {
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
    resolveTemplateSource(name) {
      // Direct lookups support callers that already resolved a Vite glob key.
      // eslint-disable-next-line security/detect-object-injection
      const direct = sources[name];
      if (typeof direct === 'string') {
        return direct;
      }

      return resolveFromMap(sources, candidateKeysForReference(name, env));
    },
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
 * @param {string} name - Template identifier.
 * @returns {string|undefined} Raw Twig source when available.
 */
export function resolveTemplateSource(name) {
  return defaultResolver.resolveTemplateSource(name);
}
