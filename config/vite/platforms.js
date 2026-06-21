/**
 * @file Platform adapter definitions for Emulsify project behavior.
 *
 * Adapters expose platform-specific defaults as serializable data so the same
 * decisions can be used by Node-side Vite config and Storybook browser code.
 */

const noneAdapter = {
  name: 'none',
  outputStrategy: 'dist',
  storybook: {
    loadDrupalBehaviorShim: false,
    attachDrupalBehaviors: false,
    registerDrupalTwigFilters: false,
    loadMirroredComponentCss: false,
    allowSyncXhrSource: false,
  },
  build: {
    mirrorDistComponentsToRoot: false,
  },
};

const drupalAdapter = {
  name: 'drupal',
  outputStrategy: 'drupal-sdc',
  storybook: {
    loadDrupalBehaviorShim: true,
    attachDrupalBehaviors: true,
    registerDrupalTwigFilters: true,
    loadMirroredComponentCss: true,
    allowSyncXhrSource: false,
  },
  build: {
    mirrorDistComponentsToRoot: true,
  },
};

const adapters = {
  none: noneAdapter,
  generic: noneAdapter,
  drupal: drupalAdapter,
};

/**
 * Deep-clone an adapter so callers can safely serialize or extend it.
 *
 * @param {object} adapter - Adapter definition.
 * @returns {object} Adapter clone.
 */
function cloneAdapter(adapter) {
  return JSON.parse(JSON.stringify(adapter));
}

/**
 * Normalize configured platform names to canonical identifiers.
 *
 * `generic` is retained as a legacy alias for existing projects, but new
 * configuration should use `none` for projects without platform-specific
 * behavior.
 *
 * @param {*} platform - Candidate platform name.
 * @returns {string} Canonical platform name.
 */
export function normalizePlatformName(platform = 'none') {
  const key = (platform || '').toString().toLowerCase().trim();
  if (!key || key === 'generic') {
    return 'none';
  }
  return key;
}

/**
 * Resolve the platform adapter for a normalized platform name.
 *
 * Unknown platforms intentionally use `none` behavior while preserving the
 * resolved `platform` string separately on the environment object.
 *
 * @param {string} [platform='none'] - Normalized platform name.
 * @returns {object} Serializable platform adapter.
 */
export function getPlatformAdapter(platform = 'none') {
  const key = normalizePlatformName(platform);
  if (key === 'drupal') {
    return cloneAdapter(drupalAdapter);
  }
  return cloneAdapter(noneAdapter);
}

export { adapters };
