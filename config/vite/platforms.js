/**
 * @file Platform adapter definitions for Emulsify project behavior.
 *
 * Adapters expose platform-specific defaults as serializable data so the same
 * decisions can be used by Node-side Vite config and Storybook browser code.
 */

const genericAdapter = {
  name: 'generic',
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
  generic: genericAdapter,
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
 * Resolve the platform adapter for a normalized platform name.
 *
 * Unknown platforms intentionally use generic behavior while preserving the
 * resolved `platform` string separately on the environment object.
 *
 * @param {string} [platform='generic'] - Normalized platform name.
 * @returns {object} Serializable platform adapter.
 */
export function getPlatformAdapter(platform = 'generic') {
  const key = (platform || 'generic').toString().toLowerCase().trim();
  if (key === 'drupal') {
    return cloneAdapter(drupalAdapter);
  }
  return cloneAdapter(genericAdapter);
}

export { adapters };
