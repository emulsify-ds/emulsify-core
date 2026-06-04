/**
 * @file Twig include() runtime helper for Storybook-rendered templates.
 */

import { createTwigIncludeFunction as createIncludeFunction } from './include-function.js';
import resolveTemplate from './resolver.js';

/**
 * Create a Twig.js `include()` function with the Storybook template resolver.
 *
 * @param {Function} resolver - Template resolver.
 * @returns {Function} Twig.js function implementation.
 */
export function createTwigIncludeFunction(resolver = resolveTemplate) {
  return createIncludeFunction(resolver);
}

/**
 * Twig `include()` runtime helper.
 *
 * @param {Object} Twig - Twig.js module.
 * @returns {undefined}
 */
function twigInclude(Twig) {
  Twig.extendFunction('include', createIncludeFunction(resolveTemplate));
}

export default twigInclude;
