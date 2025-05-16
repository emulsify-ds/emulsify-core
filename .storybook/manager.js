// .storybook/manager.js

import { addons } from '@storybook/manager-api';
import emulsifyTheme from './emulsifyTheme';

/**
 * Dynamically import the user-provided Storybook theme override.
 * Falls back to the default Emulsify theme if the import fails or is empty.
 */
import('../../../../config/emulsify-core/storybook/theme')
  /**
   * Handle successful dynamic import of the theme module.
   * @param {{ default: object }} module - The imported theme module.
   */
  .then(({ default: customTheme }) => {
    /**
     * Determine if the imported theme object is empty or not.
     * @type {boolean}
     */
    const isEmptyObject =
      !customTheme ||
      (typeof customTheme === 'object' && Object.keys(customTheme).length === 0);

    /**
     * Apply the chosen theme to Storybook’s manager UI configuration.
     * @type {{ theme: object }}
     */
    addons.setConfig({
      theme: isEmptyObject ? emulsifyTheme : customTheme,
    });
  })
  /**
   * Handle failure of the dynamic import (e.g., file not found).
   * @returns {void}
   */
  .catch(() => {
    addons.setConfig({
      /**
       * Fallback to the default Emulsify theme on import error.
       * @type {{ theme: object }}
       */
      theme: emulsifyTheme,
    });
  });
  