/**
 * @file Tests for the Twig.js extension installer virtual module plugin.
 */

import {
  VIRTUAL_TWIG_EXTENSION_INSTALLERS_ID,
  virtualTwigExtensionInstallersPlugin,
} from './twig-extension-installers.js';

describe('virtual Twig extension installer module plugin', () => {
  it('resolves and loads the virtual module', () => {
    const plugin = virtualTwigExtensionInstallersPlugin({
      registerDrupalTwigFilters: true,
    });
    const resolvedId = plugin.resolveId(VIRTUAL_TWIG_EXTENSION_INSTALLERS_ID);

    expect(resolvedId).toBe('\0virtual:emulsify-twig-extension-installers');
    expect(plugin.resolveId('/real/module.js')).toBeNull();
    expect(plugin.load(resolvedId)).toContain(
      'export const twigExtensionInstallers = installers;',
    );
    expect(plugin.load('/real/module.js')).toBeNull();
  });
});
