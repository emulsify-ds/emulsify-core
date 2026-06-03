/**
 * @file Tests for optional Twig.js extension resolution.
 */

import {
  DRUPAL_TWIG_FILTERS_MODULE_SPECIFIER,
  generateTwigExtensionInstallersModule,
  registerConfiguredTwigExtensions,
  shouldRegisterDrupalTwigFilters,
  twigExtensionModuleSpecifiers,
} from './twig-extensions.js';

describe('Twig.js extension configuration', () => {
  it('enables Drupal filters from the platform adapter or explicit Storybook config', () => {
    expect(
      shouldRegisterDrupalTwigFilters({
        platformAdapter: {
          storybook: {
            registerDrupalTwigFilters: true,
          },
        },
      }),
    ).toBe(true);

    expect(
      shouldRegisterDrupalTwigFilters({
        projectConfig: {
          storybook: {
            registerDrupalTwigFilters: true,
          },
        },
      }),
    ).toBe(true);
  });

  it('lets project config explicitly disable platform Drupal filters', () => {
    expect(
      shouldRegisterDrupalTwigFilters({
        projectConfig: {
          storybook: {
            registerDrupalTwigFilters: false,
          },
        },
        platformAdapter: {
          storybook: {
            registerDrupalTwigFilters: true,
          },
        },
      }),
    ).toBe(false);
  });

  it('builds the browser installer module only when Drupal filters are enabled', () => {
    expect(twigExtensionModuleSpecifiers({})).toEqual([]);
    expect(
      twigExtensionModuleSpecifiers({
        registerDrupalTwigFilters: true,
      }),
    ).toEqual([DRUPAL_TWIG_FILTERS_MODULE_SPECIFIER]);

    expect(generateTwigExtensionInstallersModule({})).not.toContain(
      DRUPAL_TWIG_FILTERS_MODULE_SPECIFIER,
    );
    expect(
      generateTwigExtensionInstallersModule({
        registerDrupalTwigFilters: true,
      }),
    ).toContain(DRUPAL_TWIG_FILTERS_MODULE_SPECIFIER);
  });

  it('registers configured Drupal filters on a Node-side Twig instance', () => {
    const Twig = {
      extendFilter: jest.fn(),
      extendFunction: jest.fn(),
    };

    registerConfiguredTwigExtensions(Twig, {
      registerDrupalTwigFilters: true,
    });

    expect(Twig.extendFilter).toHaveBeenCalledWith(
      'clean_id',
      expect.any(Function),
    );
    expect(Twig.extendFunction).toHaveBeenCalledWith(
      'attach_library',
      expect.any(Function),
    );
  });
});
