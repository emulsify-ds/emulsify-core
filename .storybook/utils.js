/**
 * @file Shared Storybook runtime helpers.
 */

import { registerTwigExtensions } from '../src/extensions/twig/index.js';
import {
  attachStorybookBehaviors,
  genericStorybookAdapter,
  normalizeStorybookPlatformAdapter,
} from '../src/storybook/platform-behaviors.js';
import twigInclude from './polyfills/twig-include';
import twigSource from './polyfills/twig-source';

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
 * Fetches and loads all CSS files from the specified directories based on the project's configuration.
 * If the platform is 'drupal', it also includes CSS files from additional component directories.
 *
 * @returns {undefined} If an error occurs, the function will return undefined.
 */
const fetchCSSFiles = () => {
  try {
    const adapter = getStorybookPlatformAdapter();

    // Load compiled CSS from dist for both development and static previews.
    const cssFiles = import.meta.glob('../../../../dist/**/*.css', {
      eager: true,
    });
    Object.values(cssFiles).forEach((css) => css);

    // Platform adapters decide whether root component CSS is expected.
    if (adapter.loadMirroredComponentCss) {
      const drupalCSSFiles = import.meta.glob(
        '../../../../components/**/*.css',
        { eager: true },
      );
      Object.values(drupalCSSFiles).forEach((css) => css);
    }
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

/**
 * Configures and extends a standard Twig object.
 *
 * The Drupal filters and BEM/add-attributes helpers are compatibility
 * extensions for existing stories; they are separate from the generic Twig
 * renderer configured in Vite.
 *
 * @param {Object} twig - Twig object that should be configured and extended.
 * @param {{ twigDrupal?: Function }} [options={}] - Optional platform extensions.
 * @returns {Object} Configured Twig object.
 */
export function setupTwig(twig, options = {}) {
  twig.cache();
  if (typeof options.twigDrupal === 'function') {
    options.twigDrupal(twig);
  }
  registerTwigExtensions(twig);
  twigInclude(twig);
  twigSource(twig);
  return twig;
}

// Keep these named exports stable for preview.js and downstream overrides.
export {
  attachStorybookBehaviors,
  fetchCSSFiles,
  genericStorybookAdapter,
  normalizeStorybookPlatformAdapter,
};
