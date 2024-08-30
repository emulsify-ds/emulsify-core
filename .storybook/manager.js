import { addons } from '@storybook/manager-api';
import emulsifyTheme from './emulsifyTheme';

import('../../../../config/emulsify-core/storybook/theme')
.then((customTheme) => {
  addons.setConfig({
    theme: customTheme.default,
  });
})
.catch(() => {
  addons.setConfig({
    theme: emulsifyTheme,
  });
});
