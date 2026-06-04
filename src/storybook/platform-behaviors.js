/**
 * @file Platform-specific Storybook behavior helpers.
 */

export const genericStorybookAdapter = {
  loadDrupalBehaviorShim: false,
  attachDrupalBehaviors: false,
  registerDrupalTwigFilters: false,
  loadMirroredComponentCss: false,
  allowSyncXhrSource: false,
};

/**
 * Normalize optional platform adapter flags into the full Storybook shape.
 *
 * @param {object} [adapter] - Candidate Storybook adapter flags.
 * @returns {object} Storybook adapter flags with generic defaults.
 */
export function normalizeStorybookPlatformAdapter(adapter = {}) {
  return {
    ...genericStorybookAdapter,
    ...(adapter || {}),
  };
}

/**
 * Attach platform-specific behaviors after a Storybook render.
 *
 * Drupal behavior attachment is opt-in through the active platform adapter.
 * Generic and unknown platforms return without creating Drupal globals.
 *
 * @param {object} [options={}] - Attachment options.
 * @param {object} [options.adapter] - Active Storybook platform adapter.
 * @param {Promise} [options.behaviorShimReady] - Optional behavior shim import.
 * @param {HTMLElement|Document} [options.context] - Behavior attachment root.
 * @param {object} [options.settings] - Behavior settings.
 * @returns {Promise<boolean>} TRUE when Drupal attachBehaviors ran.
 */
export async function attachStorybookBehaviors(options = {}) {
  const adapter = normalizeStorybookPlatformAdapter(options.adapter);
  if (!adapter.attachDrupalBehaviors) {
    return false;
  }

  await (options.behaviorShimReady || Promise.resolve());

  const browserWindow = globalThis.window;
  const drupal = browserWindow?.Drupal || globalThis.Drupal;
  if (typeof drupal?.attachBehaviors !== 'function') {
    return false;
  }

  drupal.attachBehaviors(
    options.context,
    options.settings ||
      browserWindow?.drupalSettings ||
      globalThis.drupalSettings,
  );
  return true;
}
