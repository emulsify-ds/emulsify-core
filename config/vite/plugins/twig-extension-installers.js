/**
 * @file Virtual Twig.js extension installer module for Storybook.
 */

import { generateTwigExtensionInstallersModule } from '../twig-extensions.js';

export const VIRTUAL_TWIG_EXTENSION_INSTALLERS_ID =
  'virtual:emulsify-twig-extension-installers';

const resolvedVirtualTwigExtensionInstallersId = `\0${VIRTUAL_TWIG_EXTENSION_INSTALLERS_ID}`;

/**
 * Provide configured Twig.js extension installers to browser-rendered modules.
 *
 * @param {object} [env={}] - Normalized Emulsify environment.
 * @returns {import('vite').PluginOption} Vite virtual module plugin.
 */
export function virtualTwigExtensionInstallersPlugin(env = {}) {
  return {
    name: 'emulsify-virtual-twig-extension-installers',
    resolveId(id) {
      if (id === VIRTUAL_TWIG_EXTENSION_INSTALLERS_ID) {
        return resolvedVirtualTwigExtensionInstallersId;
      }

      return null;
    },
    load(id) {
      if (id === resolvedVirtualTwigExtensionInstallersId) {
        return generateTwigExtensionInstallersModule(env);
      }

      return null;
    },
  };
}
