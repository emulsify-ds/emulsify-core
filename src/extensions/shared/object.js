/**
 * @file Object type guards shared by extension implementations.
 * @module extensions/shared/object
 */

/**
 * Determine whether a value is a plain object.
 *
 * Objects from Twig.js context data generally have either Object.prototype or
 * a null prototype. Class instances are intentionally excluded so extension
 * code does not accidentally treat rich objects as attribute maps.
 *
 * @param {*} value - Value to inspect.
 * @returns {boolean} TRUE when the value is a plain object.
 */
export function isPlainObject(value) {
  if (!value || typeof value !== 'object') return false;

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
