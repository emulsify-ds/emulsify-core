/**
 * @file Package manifest helpers for the project audit.
 */

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
