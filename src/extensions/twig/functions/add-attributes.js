/**
 * @file Native `add_attributes()` Twig function implementation.
 * @module extensions/twig/functions/add-attributes
 */

import {
  AttributeBag,
  attributesFromContext,
  clearContextAttributes,
} from '../../shared/attributes.js';

/**
 * Merge additional attributes with attributes from the current Twig context.
 *
 * @param {Object} [additionalAttributes={}] - Attributes to add or merge.
 * @param {Object} [invocationContext] - Twig.js function invocation `this`.
 * @returns {AttributeBag} AttributeBag ready for Twig serialization.
 */
export function addAttributes(additionalAttributes = {}, invocationContext) {
  // Context attributes are merged first so explicit additions can append safely.
  const attributeBag = attributesFromContext(invocationContext);
  attributeBag.merge(additionalAttributes);
  clearContextAttributes(invocationContext);

  return attributeBag;
}

/**
 * Twig.js adapter for `add_attributes()`.
 *
 * @param {Object} [additionalAttributes={}] - Attributes to add or merge.
 * @returns {AttributeBag} AttributeBag ready for Twig serialization.
 */
export function addAttributesTwigFunction(additionalAttributes = {}) {
  // Preserve Twig.js' invocation context for Drupal-compatible attributes.
  return addAttributes(additionalAttributes, this);
}

export { AttributeBag };
