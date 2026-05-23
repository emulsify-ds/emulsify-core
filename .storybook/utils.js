/**
 * @file Shared Storybook runtime helpers.
 */

import twigDrupal from 'twig-drupal-filters';
import { registerTwigExtensions } from '../src/extensions/twig/index.js';
import twigInclude from './polyfills/twig-include';
import twigSource from './polyfills/twig-source';

const projectConfigModules = import.meta.glob(
  '../../../../project.emulsify.json',
  {
    eager: true,
  },
);
const emulsifyConfig =
  Object.values(projectConfigModules)[0]?.default ||
  Object.values(projectConfigModules)[0] ||
  {};

/**
 * Fetches project-based variant configuration. If no such configuration
 * exists, returns default values as a flat component structure.
 *
 * @returns {Array} project-based variant configuration, or default config.
 */
const fetchVariantConfig = () => {
  try {
    return emulsifyConfig.variant.structureImplementations;
  } catch (e) {
    // Legacy projects without config use the top-level components directory.
    return [
      {
        name: 'components',
        directory: '../../../../components',
      },
    ];
  }
};

/**
 * Fetches and loads all CSS files from the specified directories based on the project's configuration.
 * If the platform is 'drupal', it also includes CSS files from additional component directories.
 *
 * @returns {undefined} If an error occurs, the function will return undefined.
 */
const fetchCSSFiles = () => {
  try {
    // Load compiled CSS from dist for both development and static previews.
    const cssFiles = import.meta.glob('../../../../dist/**/*.css', {
      eager: true,
    });
    Object.values(cssFiles).forEach((css) => css);

    // Drupal builds mirror component CSS to the root components directory.
    if (emulsifyConfig.project?.platform === 'drupal') {
      const drupalCSSFiles = import.meta.glob(
        '../../../../components/**/*.css',
        { eager: true },
      );
      Object.values(drupalCSSFiles).forEach((css) => css);
    }
  } catch (e) {
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
  try {
    return emulsifyConfig.project.machineName;
  } catch (e) {
    return undefined;
  }
}

/**
 * Configures and extends a standard Twig object.
 *
 * The Drupal filters and BEM/add-attributes helpers are compatibility
 * extensions for existing stories; they are separate from the generic Twig
 * renderer configured in Vite.
 *
 * @param {Object} twig - Twig object that should be configured and extended.
 * @returns {Object} Configured Twig object.
 */
export function setupTwig(twig) {
  twig.cache();
  twigDrupal(twig);
  registerTwigExtensions(twig);
  twigInclude(twig);
  twigSource(twig);
  return twig;
}

// Keep this named export stable for preview.js and downstream overrides.
export { fetchCSSFiles };
