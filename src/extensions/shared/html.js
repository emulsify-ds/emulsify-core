/**
 * @file HTML escaping and attribute-name validation helpers.
 * @module extensions/shared/html
 */

const ATTRIBUTE_NAME_PATTERN = /^[A-Za-z_:][A-Za-z0-9:_.-]*$/;

/**
 * Determine whether a name is safe to print as an HTML attribute name.
 *
 * @param {string} name - Candidate attribute name.
 * @returns {boolean} TRUE when the name can be safely serialized.
 */
export function isSafeAttributeName(name) {
  return ATTRIBUTE_NAME_PATTERN.test(String(name || ''));
}

/**
 * Escape a value for use inside a double-quoted HTML attribute.
 *
 * @param {*} value - Attribute value to serialize.
 * @returns {string} Escaped value.
 */
export function escapeAttributeValue(value) {
  return String(value).replace(/[&"<>]/g, (character) => {
    // Return the named entity for each unsafe character.
    switch (character) {
      case '&':
        return '&amp;';
      case '"':
        return '&quot;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      default:
        return character;
    }
  });
}
