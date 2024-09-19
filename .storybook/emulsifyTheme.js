// Documentation on theming Storybook: https://storybook.js.org/docs/configurations/theming/

import { create } from '@storybook/theming';

export default create({
  base: 'dark',

  // UI
  appBg: '#00405B',
  appContentBg: '#00202E',
  appBorderColor: '#00405B',
  appBorderRadius: 4,

  // Typography
  fontBase: '"Mona Sans", sans-serif',
  fontCode: 'monospace',

  // Text colors
  textColor: 'white',
  textInverseColor: 'rgba(255,255,255,0.9)',
  textMutedColor: '#E6F5FC',

  // Toolbar default and active colors
  barTextColor: '#005F89',
  barSelectedColor: '#8B1E7E',
  barBg: '#CCECFA',

  // Form colors
  inputBg: '#00202E',
  inputBorder: '#00405B',
  inputTextColor: 'white',
  inputBorderRadius: 4,
  // Branding
  brandTitle: 'Emulsify',
  brandUrl: 'https://emulsify.info',
  brandImage:
    'https://raw.githubusercontent.com/fourkitchens/emulsify-core/main/assets/images/emulsify-logo-sb.svg?token=GHSAT0AAAAAACIEXLVC5R3KBCX6HGKGTBBSZNYFWMA',
});
