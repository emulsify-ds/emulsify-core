import twigAddAttributes from 'add-attributes-twig-extension';
import twigBEM from 'bem-twig-extension';
import twigDrupal from 'twig-drupal-filters';
import emulsifyConfig from '../../../../project.emulsify.json' with { type: 'json' };

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
    // Load all CSS files from 'dist'.
    const cssFiles = import.meta.glob('../../../../dist/**/*.css', { eager: true });
    Object.values(cssFiles).forEach((css) => css);

    // Load all CSS files from 'components' for 'drupal' platform.
    if (emulsifyConfig.project.platform === 'drupal') {
      const drupalCSSFiles = import.meta.glob('../../../../components/**/*.css', { eager: true });
      Object.values(drupalCSSFiles).forEach((css) => css);
    }
  } catch (e) {
    return undefined;
  }
};

/**
 * Configures and extends a standard Twig object.
 *
 * @param {Object} twig - Twig object that should be configured and extended.
 * @returns {Object} Configured Twig object.
 */
export function setupTwig(twig) {
  twig.cache();
  twigDrupal(twig);
  twigBEM(twig);
  twigAddAttributes(twig);
  return twig;
}

// Export the fetchCSSFiles function.
export { fetchCSSFiles };
