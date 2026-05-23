/**
 * @file React extension registry placeholders.
 * @module extensions/react/register
 */

/**
 * Return a React extension definition unchanged.
 *
 * This mirrors common `defineConfig()` APIs and gives future React extension
 * authors a stable import before the runtime registry grows.
 *
 * @param {Object} extension - React extension definition.
 * @returns {Object} The provided extension definition.
 */
export function defineReactExtension(extension) {
  // Keep this pass-through stable until React extensions need normalization.
  return extension;
}

/**
 * Normalize React extension values into a registry list.
 *
 * @param {Object[]} [extensions=[]] - Candidate extension definitions.
 * @returns {Object[]} Filtered extension definitions.
 */
export function createReactExtensionRegistry(extensions = []) {
  // Drop empty placeholders so callers can compose optional extension arrays.
  return extensions.filter(Boolean);
}
