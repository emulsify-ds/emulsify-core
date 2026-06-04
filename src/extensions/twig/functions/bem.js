/**
 * @file Native `bem()` Twig function implementation.
 * @module extensions/twig/functions/bem
 */

import {
  AttributeBag,
  attributesFromContext,
  clearContextAttributes,
} from '../../shared/attributes.js';
import { flattenList } from '../../shared/lists.js';
import { isPlainObject } from '../../shared/object.js';

/**
 * Normalize positional and object-style BEM arguments into one shape.
 *
 * @param {string|Object} baseClass - Base class or options object.
 * @param {*[]} modifiers - Positional modifiers.
 * @param {string} blockname - Positional block name.
 * @param {*[]} extra - Positional extra classes.
 * @param {Object} attributes - Positional extra attributes.
 * @returns {{
 *   baseClass: *,
 *   modifiers: *,
 *   blockname: *,
 *   extra: *,
 *   attributes: Object
 * }} Normalized BEM options.
 */
function normalizeBemOptions(
  baseClass,
  modifiers,
  blockname,
  extra,
  attributes,
) {
  if (!isPlainObject(baseClass)) {
    return {
      baseClass,
      modifiers,
      blockname,
      extra,
      attributes,
    };
  }

  const options = baseClass;
  const hasBEMObjectShape = options.block && options.element;

  // Prefer explicit keys, then map block/element object syntax.
  return {
    baseClass:
      options.baseClass ||
      options.base_class ||
      options.base ||
      (hasBEMObjectShape ? options.element : options.block),
    modifiers: options.modifiers || [],
    blockname:
      options.blockname ||
      options.blockName ||
      (hasBEMObjectShape ? options.block : options.element) ||
      '',
    extra: options.extra || [],
    attributes: options.attributes || {},
  };
}

/**
 * Convert an argument into a clean list while preserving string contents.
 *
 * Class-token sanitization happens later in AttributeBag so BEM composition can
 * treat classes and attributes through one path.
 *
 * @param {*} value - Value to normalize.
 * @returns {*[]} Flattened non-empty values.
 */
function normalizeList(value) {
  return flattenList(value).filter((item) => {
    return item !== null && typeof item !== 'undefined' && item !== '';
  });
}

/**
 * Build BEM attributes.
 *
 * @param {string|Object} baseClass - Base class or object-style options.
 * @param {*[]} [modifiers=[]] - Modifier values.
 * @param {string} [blockname=''] - Block name for element output.
 * @param {*[]} [extra=[]] - Non-BEM class values.
 * @param {Object} [attributes={}] - Additional attributes.
 * @param {Object} [invocationContext] - Twig.js function invocation `this`.
 * @returns {AttributeBag} AttributeBag ready for Twig serialization.
 */
export function bemAttributes(
  baseClass,
  modifiers = [],
  blockname = '',
  extra = [],
  attributes = {},
  invocationContext,
) {
  const options = normalizeBemOptions(
    baseClass,
    modifiers,
    blockname,
    extra,
    attributes,
  );
  const normalizedBaseClass = String(options.baseClass || '').trim();
  const normalizedBlockname = String(options.blockname || '').trim();
  const classes = [];

  // Generate canonical BEM class names before adding non-BEM extras.
  if (normalizedBaseClass) {
    const classPrefix = normalizedBlockname
      ? `${normalizedBlockname}__${normalizedBaseClass}`
      : normalizedBaseClass;

    classes.push(classPrefix);

    for (const modifier of normalizeList(options.modifiers)) {
      classes.push(`${classPrefix}--${modifier}`);
    }
  }

  classes.push(...normalizeList(options.extra));

  const attributeBag = new AttributeBag(options.attributes);
  attributeBag.addClass(classes);

  // Merge then clear context attributes to match Drupal's print-once model.
  if (invocationContext?.context?.attributes) {
    const contextAttributes = attributesFromContext(invocationContext);
    attributeBag.merge(contextAttributes);
    clearContextAttributes(invocationContext);
  }

  return attributeBag;
}

/**
 * Twig.js adapter for `bem()`.
 *
 * @param {string|Object} baseClass - Base class or object-style options.
 * @param {*[]} modifiers - Modifier values.
 * @param {string} blockname - Block name for element output.
 * @param {*[]} extra - Non-BEM class values.
 * @param {Object} attributes - Additional attributes.
 * @returns {AttributeBag} AttributeBag ready for Twig serialization.
 */
export function bemTwigFunction(
  baseClass,
  modifiers,
  blockname,
  extra,
  attributes,
) {
  return bemAttributes(
    baseClass,
    modifiers,
    blockname,
    extra,
    attributes,
    this,
  );
}
