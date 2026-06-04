/**
 * @file Storybook manager bootstrap and theme selection.
 */

import { addons } from 'storybook/manager-api';
import emulsifyTheme from './emulsifyTheme';

/**
 * Dynamically import the user-provided Storybook theme override.
 * Falls back to the default Emulsify theme if the import fails or is empty.
 */
import('../../../../config/emulsify-core/storybook/theme')
  /**
   * Apply a project theme override when one exists.
   *
   * @param {{ default: object }} module - The imported theme module.
   */
  .then(({ default: customTheme }) => {
    // Empty override files should still fall back to the package theme.
    const isEmptyObject =
      !customTheme ||
      (typeof customTheme === 'object' &&
        Object.keys(customTheme).length === 0);

    addons.setConfig({
      theme: isEmptyObject ? emulsifyTheme : customTheme,
    });
  })
  /**
   * Fall back to the default theme when the project override is absent.
   *
   * @returns {void}
   */
  .catch(() => {
    addons.setConfig({
      theme: emulsifyTheme,
    });
  });
