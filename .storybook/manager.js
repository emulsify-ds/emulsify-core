import { addons } from '@storybook/manager-api';
import emulsifyTheme from './emulsifyTheme';

import('../../../../config/emulsify-core/storybook/theme')
  .then(({ default: customTheme }) => {
    const isEmptyObject =
      !customTheme ||
      (typeof customTheme === 'object' && Object.keys(customTheme).length === 0);

    addons.setConfig({
      theme: isEmptyObject ? emulsifyTheme : customTheme,
    });
  })
  .catch(() => {
    // If the dynamic import itself fails…
    addons.setConfig({
      theme: emulsifyTheme,
    });
  });
