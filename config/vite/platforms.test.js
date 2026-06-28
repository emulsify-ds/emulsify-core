/**
 * @file Tests for Emulsify platform adapter resolution.
 */

import { getPlatformAdapter, normalizePlatformName } from './platforms.js';

describe('platform adapter resolution', () => {
  it('normalizes missing and legacy generic platforms to none', () => {
    expect(normalizePlatformName()).toBe('none');
    expect(normalizePlatformName('')).toBe('none');
    expect(normalizePlatformName('generic')).toBe('none');
    expect(normalizePlatformName(' Generic ')).toBe('none');
  });

  it('uses non-platform behavior for none, legacy generic, and unknown platforms', () => {
    for (const platform of ['none', 'generic', 'unknown']) {
      expect(getPlatformAdapter(platform)).toMatchObject({
        name: 'none',
        outputStrategy: 'dist',
        storybook: {
          loadDrupalBehaviorShim: false,
          attachDrupalBehaviors: false,
          registerDrupalTwigFilters: false,
        },
        build: {
          mirrorDistComponentsToRoot: false,
        },
      });
    }
  });

  it('uses WordPress behavior for the WordPress platform', () => {
    expect(normalizePlatformName(' WordPress ')).toBe('wordpress');
    expect(getPlatformAdapter('wordpress')).toMatchObject({
      name: 'wordpress',
      outputStrategy: 'dist',
      storybook: {
        loadDrupalBehaviorShim: false,
        attachDrupalBehaviors: false,
        registerDrupalTwigFilters: false,
        loadMirroredComponentCss: false,
        allowSyncXhrSource: false,
      },
      build: {
        mirrorDistComponentsToRoot: false,
      },
    });
  });

  it('uses Drupal behavior only for the Drupal platform', () => {
    expect(getPlatformAdapter('drupal')).toMatchObject({
      name: 'drupal',
      outputStrategy: 'drupal-sdc',
      storybook: {
        loadDrupalBehaviorShim: true,
        attachDrupalBehaviors: true,
        registerDrupalTwigFilters: true,
      },
      build: {
        mirrorDistComponentsToRoot: true,
      },
    });
  });
});
