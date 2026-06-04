/**
 * @file Storybook preview parameter override helpers.
 */

/**
 * Determine whether a value is a plain object suitable for recursive merging.
 *
 * @param {*} value - Candidate value.
 * @returns {boolean} TRUE when value is a plain object.
 */
function isPlainObject(value) {
  return (
    Boolean(value) &&
    Object.prototype.toString.call(value) === '[object Object]'
  );
}

/**
 * Merge Storybook preview parameters while preserving nested defaults.
 *
 * Arrays and non-object values are intentionally replaced by overrides. Plain
 * objects merge recursively so partial `a11y.config` overrides keep defaults
 * such as the enabled rule list unless a project explicitly replaces them.
 *
 * @param {object} [defaults={}] - Default Storybook parameters.
 * @param {object} [overrides={}] - Project override parameters.
 * @returns {object} Merged parameters.
 */
export function mergePreviewParameters(defaults = {}, overrides = {}) {
  const merged = { ...defaults };

  for (const [key, value] of Object.entries(overrides || {})) {
    if (value === undefined) continue;

    // Storybook parameter keys are intentionally dynamic.
    // eslint-disable-next-line security/detect-object-injection
    const current = merged[key];
    const nextValue =
      isPlainObject(current) && isPlainObject(value)
        ? mergePreviewParameters(current, value)
        : value;

    // Storybook parameter keys are intentionally dynamic.
    // eslint-disable-next-line security/detect-object-injection
    merged[key] = nextValue;
  }

  return merged;
}

/**
 * Extract parameter overrides from a Vite-imported project preview module.
 *
 * Supports both direct parameter objects:
 *   export default { layout: 'centered' }
 *
 * And Storybook-shaped modules:
 *   export const parameters = { layout: 'centered' }
 *   export default { parameters: { layout: 'centered' } }
 *
 * @param {object} [module] - Imported preview override module.
 * @returns {object} Preview parameter overrides.
 */
export function normalizePreviewOverrideModule(module = {}) {
  const defaultExport = module?.default;

  if (isPlainObject(module?.parameters)) {
    return module.parameters;
  }
  if (isPlainObject(defaultExport?.parameters)) {
    return defaultExport.parameters;
  }
  if (isPlainObject(defaultExport)) {
    return defaultExport;
  }
  if (isPlainObject(module)) {
    return module;
  }

  return {};
}
