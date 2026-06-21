/**
 * @file Tests for Storybook main configuration override helpers.
 */

import {
  applyStorybookConfigOverrides,
  mergeStorybookAddons,
  normalizeStorybookConfigOverrideModule,
} from './main-config.js';

describe('Storybook main config overrides', () => {
  const baseConfig = {
    addons: [
      '@storybook/addon-a11y',
      '@storybook/addon-links',
      '@storybook/addon-themes',
    ],
    framework: {
      name: '@storybook/react-vite',
      options: {},
    },
  };

  it('appends project addons after Emulsify defaults', () => {
    expect(
      mergeStorybookAddons(baseConfig.addons, ['@storybook/addon-viewport']),
    ).toEqual([
      '@storybook/addon-a11y',
      '@storybook/addon-links',
      '@storybook/addon-themes',
      '@storybook/addon-viewport',
    ]);
  });

  it('replaces default addon entries with project options for the same addon', () => {
    expect(
      mergeStorybookAddons(baseConfig.addons, [
        {
          name: '@storybook/addon-a11y',
          options: { manual: true },
        },
      ]),
    ).toEqual([
      {
        name: '@storybook/addon-a11y',
        options: { manual: true },
      },
      '@storybook/addon-links',
      '@storybook/addon-themes',
    ]);
  });

  it('can replace the default addon list when requested', () => {
    expect(
      mergeStorybookAddons(baseConfig.addons, ['@storybook/addon-viewport'], {
        replace: true,
      }),
    ).toEqual(['@storybook/addon-viewport']);
  });

  it('normalizes project main override modules', () => {
    const extendConfig = jest.fn();

    expect(
      normalizeStorybookConfigOverrideModule({
        default: { addons: ['example-addon'] },
        extendConfig,
        replaceAddons: true,
      }),
    ).toEqual({
      config: { addons: ['example-addon'] },
      extendConfig,
      replaceAddons: true,
    });
  });

  it('applies addon and config overrides without dropping defaults', async () => {
    await expect(
      applyStorybookConfigOverrides(baseConfig, {
        config: {
          addons: ['@storybook/addon-viewport'],
          docs: { autodocs: true },
        },
      }),
    ).resolves.toEqual({
      ...baseConfig,
      addons: [
        '@storybook/addon-a11y',
        '@storybook/addon-links',
        '@storybook/addon-themes',
        '@storybook/addon-viewport',
      ],
      docs: { autodocs: true },
    });
  });

  it('passes context to config factories and extendConfig', async () => {
    const env = { platform: 'none' };
    const extendConfig = jest.fn((config, context) => ({
      ...config,
      staticDirs: [context.env.platform],
    }));

    await expect(
      applyStorybookConfigOverrides(
        baseConfig,
        {
          config: ({ env: contextEnv }) => ({
            addons: [`addon-${contextEnv.platform}`],
          }),
          extendConfig,
        },
        { env },
      ),
    ).resolves.toEqual({
      ...baseConfig,
      addons: [
        '@storybook/addon-a11y',
        '@storybook/addon-links',
        '@storybook/addon-themes',
        'addon-none',
      ],
      staticDirs: ['none'],
    });
    expect(extendConfig).toHaveBeenCalled();
  });
});
