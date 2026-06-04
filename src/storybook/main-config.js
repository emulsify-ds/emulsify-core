/**
 * @file Helpers for applying project Storybook main configuration overrides.
 */

/**
 * Identify a Storybook addon so project config can override default addon
 * options without duplicating the addon in the final list.
 *
 * @param {string|{name?: string}} addon - Storybook addon entry.
 * @returns {string|null} Stable addon key when available.
 */
function addonKey(addon) {
  if (typeof addon === 'string') return addon;
  if (addon && typeof addon.name === 'string') return addon.name;
  return null;
}

/**
 * Merge Storybook addon lists while preserving default addon order.
 *
 * Project addons are appended by default. When a project provides an addon with
 * the same package name as a default addon, its entry replaces the default so
 * projects can configure default addons without creating duplicates.
 *
 * @param {Array<string|object>} defaults - Emulsify Core default addons.
 * @param {Array<string|object>} overrides - Project-provided addons.
 * @param {{ replace?: boolean }} [options] - Whether overrides replace defaults.
 * @returns {Array<string|object>} Final addon list.
 */
export function mergeStorybookAddons(
  defaults = [],
  overrides = [],
  { replace = false } = {},
) {
  if (replace) return [...overrides];

  const merged = [...defaults];
  const indexesByKey = new Map();

  merged.forEach((addon, index) => {
    const key = addonKey(addon);
    if (key) indexesByKey.set(key, index);
  });

  for (const addon of overrides) {
    const key = addonKey(addon);
    const existingIndex = key ? indexesByKey.get(key) : undefined;
    if (existingIndex !== undefined) {
      merged.splice(existingIndex, 1, addon);
      continue;
    }

    if (key) indexesByKey.set(key, merged.length);
    merged.push(addon);
  }

  return merged;
}

/**
 * Normalize an optional project `config/emulsify-core/storybook/main.js` module.
 *
 * @param {object} [module] - ESM module namespace loaded from the project.
 * @returns {{ config: object|Function, extendConfig?: Function, replaceAddons: boolean }}
 * Normalized override details.
 */
export function normalizeStorybookConfigOverrideModule(module = {}) {
  const config = module.default || {};

  return {
    config,
    extendConfig:
      typeof module.extendConfig === 'function'
        ? module.extendConfig
        : undefined,
    replaceAddons: module.replaceAddons === true,
  };
}

/**
 * Apply project Storybook main config overrides to Emulsify's default config.
 *
 * Default-exported override objects are shallow-merged, except `addons`, which
 * are appended by default. Export `replaceAddons = true` or include
 * `replaceAddons: true` in the default config object when full replacement is
 * needed. Named `extendConfig()` runs last for advanced cases.
 *
 * @param {object} baseConfig - Emulsify Core Storybook config.
 * @param {{ config?: object|Function, extendConfig?: Function, replaceAddons?: boolean }} [overrides]
 * Project override details.
 * @param {object} [context] - Context passed to config factories.
 * @returns {Promise<object>} Final Storybook config.
 */
export async function applyStorybookConfigOverrides(
  baseConfig,
  overrides = {},
  context = {},
) {
  const rawConfig =
    typeof overrides.config === 'function'
      ? await overrides.config(context)
      : overrides.config;
  const plainConfig =
    rawConfig && typeof rawConfig === 'object' ? { ...rawConfig } : {};
  const configReplaceAddons = plainConfig.replaceAddons === true;
  delete plainConfig.replaceAddons;
  delete plainConfig.extendConfig;
  const replaceAddons = overrides.replaceAddons || configReplaceAddons === true;

  let merged = {
    ...baseConfig,
    ...plainConfig,
  };

  if (Array.isArray(plainConfig.addons)) {
    merged = {
      ...merged,
      addons: mergeStorybookAddons(baseConfig.addons, plainConfig.addons, {
        replace: replaceAddons,
      }),
    };
  }

  if (typeof overrides.extendConfig === 'function') {
    const extended = await overrides.extendConfig(merged, context);
    if (extended && typeof extended === 'object') {
      merged = extended;
    }
  }

  return merged;
}
