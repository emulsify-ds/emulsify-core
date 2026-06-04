/**
 * @file React extension registry placeholders.
 * @module extensions/react/register
 */

/**
 * Return the provided React extension definition unchanged.
 *
 * @reserved Registry behavior is not yet implemented and may change in a
 * future minor release.
 * @example
 * const extension = defineReactExtension({
 *   name: 'project-react-components',
 *   components: {},
 * });
 * // Safe today: use `extension` directly instead of relying on registry side
 * // effects.
 *
 * @param {Object} extension - React extension definition.
 * @returns {Object} The provided extension definition.
 */
export function defineReactExtension(extension) {
  // Keep this pass-through stable until React extensions need normalization.
  return extension;
}

/**
 * Return React extension definitions after filtering falsy values.
 *
 * @reserved Registry behavior is not yet implemented and may change in a
 * future minor release.
 * @example
 * const registry = createReactExtensionRegistry([
 *   maybeExtension && defineReactExtension(maybeExtension),
 * ]);
 * // Safe today: read from `registry` directly instead of relying on runtime
 * // registration.
 *
 * @param {Object[]} [extensions=[]] - Candidate extension definitions.
 * @returns {Object[]} Filtered extension definitions.
 */
export function createReactExtensionRegistry(extensions = []) {
  // Drop empty placeholders so callers can compose optional extension arrays.
  return extensions.filter(Boolean);
}
