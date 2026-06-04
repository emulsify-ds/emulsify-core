/**
 * @file Twig source() runtime helper for Storybook-rendered templates.
 */

import { resolveTemplateSource } from './resolver.js';
import {
  createTwigSourceFunction as createSourceFunction,
  resolveAssetSource,
} from './source-function.js';

export { resolveAssetSource };

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
  return createSourceFunction(templateSourceResolver);
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
