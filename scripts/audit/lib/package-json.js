/**
 * @file Package manifest helpers for the project audit.
 */

/**
 * Return a nested object value.
 *
 * @param {object} obj - Object to inspect.
 * @param {string[]} pathParts - Nested object path.
 * @returns {*} Nested value.
 */
export function valueAtPath(obj, pathParts) {
  return pathParts.reduce(
    (current, key) =>
      current && typeof current === 'object' ? current[key] : undefined,
    obj,
  );
}

/**
 * Determine whether a package manifest depends on Emulsify Core.
 *
 * @param {object} packageJson - Parsed package.json.
 * @returns {boolean} TRUE when package.json is Core or consumes Core.
 */
export function packageUsesEmulsifyCore(packageJson = {}) {
  if (packageJson.name === '@emulsify/core') {
    return true;
  }

  return [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
  ].some((section) =>
    Object.prototype.hasOwnProperty.call(
      packageJson[section] || {},
      '@emulsify/core',
    ),
  );
}

/**
 * Determine whether a package manifest is Emulsify Core itself.
 *
 * @param {object} packageJson - Parsed package.json.
 * @returns {boolean} TRUE when package.json is Core.
 */
export function packageIsEmulsifyCore(packageJson = {}) {
  return packageJson.name === '@emulsify/core';
}

/**
 * Determine whether a recommended override is already present.
 *
 * @param {object} overrides - package.json overrides object.
 * @param {{paths: string[][]}} recommendation - Override recommendation.
 * @returns {boolean} TRUE when any equivalent override path exists.
 */
export function hasRecommendedOverride(overrides = {}, recommendation) {
  return recommendation.paths.some(
    (pathParts) => valueAtPath(overrides, pathParts) !== undefined,
  );
}
