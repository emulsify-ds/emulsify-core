import { resolve, dirname } from 'path';
import twigDrupal from 'twig-drupal-filters';
import twigBEM from 'bem-twig-extension';
import twigAddAttributes from 'add-attributes-twig-extension';
import emulsifyConfig from '../../../../project.emulsify.json' with { type: 'json' };

// Create __filename from import.meta.url without fileURLToPath
let _filename = decodeURIComponent(new URL(import.meta.url).pathname);

// On Windows, remove the leading slash (e.g. "/C:/path" -> "C:/path")
if (process.platform === 'win32' && _filename.startsWith('/')) {
  _filename = _filename.slice(1);
}

const _dirname = dirname(_filename);

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
    const cssFiles = require.context('../../../../dist', true, /\.css$/);
    cssFiles.keys().forEach((file) => cssFiles(file));

    // Load all CSS files from 'components' for 'drupal' platform.
    if (emulsifyConfig.project.platform === 'drupal') {
      const drupalCSSFiles = require.context('../../../../components', true, /\.css$/);
      drupalCSSFiles.keys().forEach((file) => drupalCSSFiles(file));
    }
  } catch (e) {
    return undefined;
  }
};

// Build namespaces mapping.
export const namespaces = {};
for (const { name, directory } of fetchVariantConfig()) {
  namespaces[name] = resolve(_dirname, '../../../../', directory);
}

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
