/**
 * @file Tests for Storybook platform behavior helpers.
 */

import {
  attachStorybookBehaviors,
  normalizeStorybookPlatformAdapter,
} from './platform-behaviors.js';

describe('Storybook platform behavior helpers', () => {
  afterEach(() => {
    delete window.Drupal;
    delete window.drupalSettings;
  });

  it('attaches Drupal behaviors when the adapter enables Drupal support', async () => {
    const context = document.createElement('main');
    window.drupalSettings = { path: { currentPath: '/storybook' } };
    window.Drupal = {
      attachBehaviors: jest.fn(),
    };

    const attached = await attachStorybookBehaviors({
      adapter: { attachDrupalBehaviors: true },
      context,
    });

    expect(attached).toBe(true);
    expect(window.Drupal.attachBehaviors).toHaveBeenCalledWith(
      context,
      window.drupalSettings,
    );
  });

  it('does not attach or create Drupal globals for generic platforms', async () => {
    const attached = await attachStorybookBehaviors({
      adapter: { attachDrupalBehaviors: false },
    });

    expect(attached).toBe(false);
    expect(window.Drupal).toBeUndefined();
  });

  it('does not throw when Drupal is absent and attachment is disabled', async () => {
    await expect(
      attachStorybookBehaviors({
        adapter: normalizeStorybookPlatformAdapter(),
      }),
    ).resolves.toBe(false);
    expect(window.Drupal).toBeUndefined();
  });

  it('waits for the Drupal behavior shim before attaching behaviors', async () => {
    const attach = jest.fn();
    const behaviorShimReady = Promise.resolve().then(() => {
      window.Drupal = {
        attachBehaviors: attach,
      };
      window.drupalSettings = {};
    });

    const attached = await attachStorybookBehaviors({
      adapter: { attachDrupalBehaviors: true },
      behaviorShimReady,
    });

    expect(attached).toBe(true);
    expect(attach).toHaveBeenCalledTimes(1);
  });
});
