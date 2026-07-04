/**
 * @file Tests for Emulsify platform adapter resolution.
 */

import {
  adapters,
  getPlatformAdapter,
  normalizePlatformName,
} from './platforms.js';

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

  it('returns mutable adapter clones without changing later resolutions', () => {
    const adapter = getPlatformAdapter('wordpress');

    adapter.outputStrategy = 'changed';
    adapter.storybook.loadDrupalBehaviorShim = true;
    adapter.build.mirrorDistComponentsToRoot = true;

    expect(getPlatformAdapter('wordpress')).toMatchObject({
      name: 'wordpress',
      outputStrategy: 'dist',
      storybook: {
        loadDrupalBehaviorShim: false,
      },
      build: {
        mirrorDistComponentsToRoot: false,
      },
    });
  });

  it('prevents exported adapter definitions from changing later resolutions', () => {
    expect(Reflect.set(adapters, 'wordpress', adapters.drupal)).toBe(false);
    expect(Reflect.set(adapters.wordpress, 'outputStrategy', 'changed')).toBe(
      false,
    );
    expect(
      Reflect.set(adapters.wordpress.storybook, 'loadDrupalBehaviorShim', true),
    ).toBe(false);
    expect(
      Reflect.set(adapters.wordpress.build, 'mirrorDistComponentsToRoot', true),
    ).toBe(false);

    expect(getPlatformAdapter('wordpress')).toMatchObject({
      name: 'wordpress',
      outputStrategy: 'dist',
      storybook: {
        loadDrupalBehaviorShim: false,
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
