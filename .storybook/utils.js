/**
 * @file Shared Storybook runtime helpers.
 */

import {
  attachStorybookBehaviors,
  genericStorybookAdapter,
  normalizeStorybookPlatformAdapter,
} from '../src/storybook/platform-behaviors.js';
import { setupTwig } from '../src/storybook/twig/setup.js';

const emulsifyEnv =
  (typeof __EMULSIFY_ENV__ !== 'undefined' && __EMULSIFY_ENV__) || {};

/**
 * Get the normalized Emulsify environment injected by Storybook's Vite config.
 *
 * @returns {object} Normalized Emulsify environment.
 */
export function getEmulsifyEnvironment() {
  return emulsifyEnv;
}

/**
 * Get Storybook platform behavior flags from the active adapter.
 *
 * @returns {object} Storybook adapter flags.
 */
export function getStorybookPlatformAdapter() {
  return normalizeStorybookPlatformAdapter(
    emulsifyEnv.platformAdapter?.storybook,
  );
}

/**
 * Determine whether Storybook should eagerly load all compiled CSS.
 *
 * @param {object} [parameters={}] - Storybook parameters.
 * @returns {boolean} TRUE unless `parameters.emulsify.loadAllCSS` is false.
 */
export function getLoadAllCSS(parameters = {}) {
  return parameters?.emulsify?.loadAllCSS !== false;
}

/**
 * Eagerly load CSS from the active Storybook render path.
 *
 * Drupal-style mirrored component CSS uses the root `components` CSS tree for
 * component styles and keeps shared compiled CSS from `dist` excluding
 * `dist/components`; all other projects use the compiled `dist` CSS tree. The
 * eager globs live in separate dynamically imported modules so Vite cannot
 * hoist both render paths into the same preview bundle. Projects with very
 * large CSS libraries can set `parameters.emulsify.loadAllCSS = false` and
 * import their own CSS from a preview override.
 *
 * @param {object} [parameters={}] - Storybook parameters.
 * @returns {Promise<undefined>} Resolves when the selected CSS path is loaded.
 */
const fetchCSSFiles = async (parameters = {}) => {
  try {
    if (!getLoadAllCSS(parameters)) {
      return undefined;
    }

    const adapter = getStorybookPlatformAdapter();

    if (adapter.loadMirroredComponentCss) {
      await import('./css-components.js');
      return undefined;
    }

    await import('./css-dist.js');
    return undefined;
  } catch {
    return undefined;
  }
};

/**
 * Fetches the project machine name from Emulsify configuration.
 * Returns undefined if the config is unavailable or machineName is not set.
 *
 * @returns {string|undefined} Project machine name string, or undefined if not available
 */
export function getProjectMachineName() {
  return typeof emulsifyEnv.machineName === 'string'
    ? emulsifyEnv.machineName
    : undefined;
}

// Keep these named exports stable for preview.js and downstream overrides.
export {
  attachStorybookBehaviors,
  fetchCSSFiles,
  genericStorybookAdapter,
  normalizeStorybookPlatformAdapter,
  setupTwig,
};
