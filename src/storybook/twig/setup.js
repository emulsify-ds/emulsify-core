/**
 * @file Twig runtime setup for Emulsify's Storybook integration.
 */

import { registerTwigExtensions } from '../../extensions/twig/index.js';
import { createTwigIncludeFunction } from './include-function.js';
import resolveTemplate from './resolver.js';
import twigSource from './source.js';

/**
 * Configures and extends a standard Twig object for Storybook.
 *
 * Emulsify's Twig helpers are platform-agnostic. Platform adapters can pass
 * optional Twig extension functions when a project needs CMS-specific behavior.
 *
 * @param {Object} twig - Twig object that should be configured and extended.
 * @param {{ extensions?: Function[] }} [options={}] - Optional platform extensions.
 * @returns {Object} Configured Twig object.
 */
export function setupTwig(twig, options = {}) {
  const extensions = Array.isArray(options.extensions)
    ? options.extensions
    : [];

  twig.cache();
  registerTwigExtensions(twig);
  twigInclude(twig);
  twigSource(twig);

  for (const extension of extensions) {
    if (typeof extension === 'function') {
      extension(twig);
    }
  }

  return twig;
}

/**
 * Twig `include()` runtime helper.
 *
 * @param {Object} Twig - Twig.js module.
 * @returns {undefined}
 */
export function twigInclude(Twig) {
  Twig.extendFunction('include', createTwigIncludeFunction(resolveTemplate));
}

export { default as twigSource } from './source.js';
