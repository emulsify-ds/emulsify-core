/**
 * @file Native Twig function map.
 * @module extensions/twig/function-map
 */

import { addAttributesTwigFunction } from './functions/add-attributes.js';
import { bemTwigFunction } from './functions/bem.js';

/**
 * Get Twig.js function definitions for native Emulsify helpers.
 *
 * @returns {Record<string, Function>} Function names keyed to Twig callbacks.
 */
export function getTwigFunctionMap() {
  return {
    add_attributes: addAttributesTwigFunction,
    bem: bemTwigFunction,
  };
}
