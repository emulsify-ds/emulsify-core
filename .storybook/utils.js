const { resolve } = require('path');
const twigDrupal = require('twig-drupal-filters');
const twigBEM = require('bem-twig-extension');
const twigAddAttributes = require('add-attributes-twig-extension');

/**
 * Fetches project-based variant configuration. If no such configuration
 * exists, returns default values as a flat component structure.
 *
 * @returns project-based variant configuration, or default config.
 */
const fetchVariantConfig = () => {
  try {
    return require('../../../../project.emulsify.json').variant.structureImplementations;
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
    const cssFiles = require.context('../../../../dist', true, /\.css$/);
    cssFiles.keys().forEach(file => cssFiles(file));

    // Load all CSS files from 'components' for 'drupal' platform.
    const emulsifyConfig = require('../../../../project.emulsify.json');
    if (emulsifyConfig.project.platform === 'drupal') {
      const drupalCSSFiles = require.context('../../../../components', true, /\.css$/);
      drupalCSSFiles.keys().forEach(file => drupalCSSFiles(file));
    }
  } catch (e) {
    return undefined;
  }
};

module.exports.namespaces = {};
for (const { name, directory } of fetchVariantConfig()) {
  module.exports.namespaces[name] = resolve(__dirname, '../../../../', directory);
}

/**
 * Configures and extends a standard twig object.
 *
 * @param {Twig} twig - twig object that should be configured and extended.
 *
 * @returns {Twig} configured twig object.
 */
module.exports.setupTwig = function setupTwig(twig) {
  twig.cache();
  twigDrupal(twig);
  twigBEM(twig);
  twigAddAttributes(twig);
  return twig;
};

// Export the fetchCSSFiles function
module.exports.fetchCSSFiles = fetchCSSFiles;
