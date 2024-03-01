import { addons } from '@storybook/addons';

import emulsifyTheme from './emulsifyTheme';

// Include custom theme preview config if it exists.
(async () => {
  let theme;
  try {
    theme = await import('../../../config/storybook/theme');
  } catch (e) {
    addons.setConfig({
      theme: emulsifyTheme,
    });
  } finally {
    addons.setConfig({
      theme: theme,
    });
  }
})()