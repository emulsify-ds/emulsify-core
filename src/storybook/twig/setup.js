/**
 * @file Twig runtime setup for Emulsify's Storybook integration.
 */

import { registerTwigExtensions } from '../../extensions/twig/index.js';
import twigInclude from './include.js';
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

export { default as twigInclude } from './include.js';
export { default as twigSource } from './source.js';
