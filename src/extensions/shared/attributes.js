/**
 * @file Attribute serialization and composition utilities.
 * @module extensions/shared/attributes
 */

import { escapeAttributeValue, isSafeAttributeName } from './html.js';
import { flattenList, uniqueList } from './lists.js';
import { isPlainObject } from './object.js';

/**
 * Cache cleaned class tokens because BEM class names repeat heavily across
 * component renders during Storybook sessions.
 *
 * @type {Map<string, string>}
 */
const classNameCache = new Map();

/**
 * Brand AttributeBag instances without exposing a mutable marker property on
 * the rendered object.
 *
 * @type {WeakSet<AttributeBag>}
 */
const attributeBags = new WeakSet();

/**
 * Clean a single value into a CSS class token compatible with Twig.js output.
 *
 * @param {*} value - Candidate class token.
 * @returns {string} Cleaned class token or an empty string.
 */
function cleanClassToken(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  // Cache by raw input so repeated BEM renders avoid repeated regex work.
  if (classNameCache.has(raw)) {
    return classNameCache.get(raw);
  }

  const cleaned = raw
    .replace(/[^_a-zA-Z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^([0-9])/, '_$1');

  classNameCache.set(raw, cleaned);
  return cleaned;
}

/**
 * Convert scalar, array, or AttributeBag values into clean class tokens.
 *
 * @param {*} value - Value containing one or more class names.
 * @returns {string[]} Clean, unique class tokens.
 */
export function classTokensFromValue(value) {
  if (isAttributeBag(value)) {
    // AttributeBag class values are already normalized by this module.
    return value.getClassList();
  }

  return uniqueList(
    flattenList(value)
      .flatMap((item) => String(item || '').split(/\s+/))
      .map((item) => cleanClassToken(item))
      .filter(Boolean),
  );
}

/**
 * Normalize non-class attribute values into serializable pieces.
 *
 * @param {*} value - Value to normalize.
 * @returns {string|string[]|boolean|Object|null} Serializable value or null.
 */
function valueToAttributeParts(value) {
  if (isAttributeBag(value)) {
    // Preserve nested AttributeBag composition for helpers like add_attributes().
    return value.toObject();
  }

  if (value === null || typeof value === 'undefined' || value === false) {
    return null;
  }

  if (Array.isArray(value)) {
    return flattenList(value)
      .filter((item) => item !== null && typeof item !== 'undefined')
      .map((item) => String(item));
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'string') {
    return String(value);
  }

  if (
    typeof value?.toString === 'function' &&
    value.toString !== Object.prototype.toString
  ) {
    return String(value);
  }

  return null;
}

/**
 * Extract class tokens from legacy `class="..."` strings.
 *
 * This keeps compatibility with old `bem()` string output without treating
 * arbitrary `key=value` strings as trusted markup.
 *
 * @param {*} value - Potential legacy class attribute string.
 * @returns {string|null} Raw class value when the string is class-only.
 */
function parseClassAttributeString(value) {
  const match = String(value || '').match(/^class=(["'])(.*?)\1$/);
  return match ? match[2] : null;
}

/**
 * Determine whether a value is an AttributeBag instance.
 *
 * @param {*} value - Value to inspect.
 * @returns {boolean} TRUE when the value is branded by this module.
 */
export function isAttributeBag(value) {
  return Boolean(
    value && typeof value === 'object' && attributeBags.has(value),
  );
}

/**
 * Mutable HTML attribute collection with safe serialization.
 *
 * The class mirrors the tiny subset of Drupal's Attribute object needed by
 * Storybook and Vite-rendered Twig templates.
 */
export class AttributeBag {
  /**
   * Create an attribute collection.
   *
   * @param {Object} [initialAttributes={}] - Initial attributes to merge.
   */
  constructor(initialAttributes = {}) {
    attributeBags.add(this);
    this.attributes = new Map();

    this.merge(initialAttributes);
  }

  /**
   * Create a copy of this collection.
   *
   * @returns {AttributeBag} New AttributeBag with equivalent attributes.
   */
  clone() {
    return new AttributeBag(this.toObject());
  }

  /**
   * Get the normalized class list.
   *
   * @returns {string[]} Current class tokens.
   */
  getClassList() {
    return this.attributes.get('class') || [];
  }

  /**
   * Append one or more class tokens.
   *
   * @param {*} value - Class value to normalize and append.
   * @returns {AttributeBag} Current instance for chaining.
   */
  addClass(value) {
    const tokens = classTokensFromValue(value);
    if (!tokens.length) return this;

    const existing = this.attributes.get('class') || [];
    this.attributes.set('class', uniqueList([...existing, ...tokens]));
    return this;
  }

  /**
   * Set or merge an attribute.
   *
   * Class values are always merged. Other attributes replace existing values
   * once they have been normalized and validated.
   *
   * @param {string} name - Attribute name.
   * @param {*} value - Attribute value.
   * @returns {AttributeBag} Current instance for chaining.
   */
  set(name, value) {
    const attributeName = String(name || '').trim();
    if (!isSafeAttributeName(attributeName)) return this;

    if (attributeName === 'class') {
      // Legacy callers may still pass class="..." strings from old helpers.
      const classString =
        typeof value === 'string' ? parseClassAttributeString(value) : null;
      this.addClass(classString || value);
      return this;
    }

    const normalizedValue = valueToAttributeParts(value);
    if (normalizedValue === null) return this;

    this.attributes.set(attributeName, normalizedValue);
    return this;
  }

  /**
   * Merge an object or another AttributeBag into this collection.
   *
   * @param {Object|AttributeBag} value - Attribute source.
   * @returns {AttributeBag} Current instance for chaining.
   */
  merge(value) {
    if (!value) return this;

    if (isAttributeBag(value)) {
      for (const [name, attributeValue] of value.attributes.entries()) {
        this.set(name, attributeValue);
      }
      return this;
    }

    if (!isPlainObject(value)) {
      return this;
    }

    for (const [name, attributeValue] of Object.entries(value)) {
      if (name === '_keys') continue;
      this.set(name, attributeValue);
    }

    return this;
  }

  /**
   * Convert attributes to a plain object.
   *
   * @returns {Object} Plain attribute map.
   */
  toObject() {
    return Object.fromEntries(this.attributes.entries());
  }

  /**
   * Serialize the attribute collection for direct Twig output.
   *
   * @returns {string} HTML-safe attribute string.
   */
  toString() {
    return Array.from(this.attributes.entries())
      .map(([name, value]) => {
        if (name === 'class' && Array.isArray(value)) {
          if (!value.length) return '';
          return `class="${escapeAttributeValue(value.join(' '))}"`;
        }

        if (value === true) {
          return name;
        }

        if (Array.isArray(value)) {
          return `${name}="${escapeAttributeValue(value.join(' '))}"`;
        }

        return `${name}="${escapeAttributeValue(value)}"`;
      })
      .filter(Boolean)
      .join(' ');
  }
}

/**
 * Build an AttributeBag from the current Twig invocation context.
 *
 * @param {Object} invocationContext - Twig.js function invocation `this`.
 * @returns {AttributeBag} Attribute collection from context attributes.
 */
export function attributesFromContext(invocationContext) {
  return new AttributeBag(invocationContext?.context?.attributes || {});
}

/**
 * Clear context attributes after they have been consumed.
 *
 * Drupal removes attributes after printing them so they do not leak into child
 * includes; this mirrors that behavior for Storybook and Vite rendering.
 *
 * @param {Object} invocationContext - Twig.js function invocation `this`.
 * @returns {void}
 */
export function clearContextAttributes(invocationContext) {
  if (
    invocationContext?.context &&
    Object.hasOwn(invocationContext.context, 'attributes')
  ) {
    invocationContext.context.attributes = {};
  }
}
