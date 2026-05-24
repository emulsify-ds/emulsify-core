/**
 * @file Native Twig logic tag definitions.
 * @module extensions/twig/tag-map
 */

import { getSwitchTagDefinitions } from './tags/switch.js';

/**
 * Get Twig.js logic tag definitions for native Emulsify helpers.
 *
 * @param {Object} Twig - Twig.js module or compatible extension target.
 * @returns {Object[]} Logic tag definitions for Twig.extendTag().
 */
export function getTwigTagDefinitions(Twig) {
  return [...getSwitchTagDefinitions(Twig)];
}
