/**
 * @file Optional Twig.js extension resolution for Storybook and Vite Twig rendering.
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export const DRUPAL_TWIG_FILTERS_MODULE_SPECIFIER =
  '@emulsify/core/storybook/twig/drupal-filters';

/**
 * Determine whether Drupal-compatible Twig.js filters should be registered.
 *
 * @param {object} [env={}] - Normalized Emulsify environment or Twig options.
 * @returns {boolean} TRUE when Drupal filter registration is enabled.
 */
export function shouldRegisterDrupalTwigFilters(env = {}) {
  const configuredValue =
    env?.storybook?.registerDrupalTwigFilters ??
    env?.projectConfig?.storybook?.registerDrupalTwigFilters;

  if (typeof configuredValue === 'boolean') {
    return configuredValue;
  }

  return Boolean(
    env?.registerDrupalTwigFilters ||
    env?.platformAdapter?.storybook?.registerDrupalTwigFilters,
  );
}

/**
 * Build browser import specifiers for configured Twig.js extension installers.
 *
 * @param {object} [env={}] - Normalized Emulsify environment or Twig options.
 * @returns {string[]} Import specifiers for extension installer modules.
 */
export function twigExtensionModuleSpecifiers(env = {}) {
  return shouldRegisterDrupalTwigFilters(env)
    ? [DRUPAL_TWIG_FILTERS_MODULE_SPECIFIER]
    : [];
}

/**
 * Normalize a CommonJS or ESM module into an extension installer function.
 *
 * @param {*} moduleValue - Imported or required extension module.
 * @returns {Function|undefined} Twig.js extension installer.
 */
function normalizeInstaller(moduleValue) {
  const installer = moduleValue?.default ?? moduleValue;
  return typeof installer === 'function' ? installer : undefined;
}

/**
 * Register configured Twig.js extension modules in Node-side Twig instances.
 *
 * @param {object} twig - Twig.js instance.
 * @param {object} [env={}] - Normalized Emulsify environment or Twig options.
 * @returns {object} The provided Twig.js instance.
 */
export function registerConfiguredTwigExtensions(twig, env = {}) {
  if (shouldRegisterDrupalTwigFilters(env)) {
    const installer = normalizeInstaller(require('twig-drupal-filters'));
    if (installer) {
      installer(twig);
    }
  }

  return twig;
}

/**
 * Generate the browser virtual module used by Storybook and Twig modules.
 *
 * @param {object} [env={}] - Normalized Emulsify environment.
 * @returns {string} JavaScript module source.
 */
export function generateTwigExtensionInstallersModule(env = {}) {
  const specifiers = twigExtensionModuleSpecifiers(env);
  const imports = specifiers
    .map((specifier, index) => {
      const variableName = `twigExtension${index}`;
      return `import ${variableName} from ${JSON.stringify(specifier)};`;
    })
    .join('\n');
  const installerNames = specifiers
    .map((_, index) => `twigExtension${index}`)
    .join(', ');

  return `
${imports}

const installers = [${installerNames}].filter(
  (installer) => typeof installer === 'function',
);

export const twigExtensionInstallers = installers;

export function registerConfiguredTwigExtensions(Twig) {
  for (const installer of installers) {
    installer(Twig);
  }

  return Twig;
}
`;
}
