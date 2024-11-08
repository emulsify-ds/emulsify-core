const { configOverrides } = require('../../../../config/emulsify-core/storybook/main');

const safeConfigOverrides = configOverrides || {};

const config = {
  stories: [
    '../../../../(src|components)/**/*.stories.@(js|jsx|ts|tsx)',
  ],
  staticDirs: [
    '../../../../assets/images',
    '../../../../assets/icons',
    '../../../../dist',
  ],
  addons: [
    '../../../@storybook/addon-a11y',
    '../../../@storybook/addon-links',
    '../../../@storybook/addon-essentials',
    '../../../@storybook/addon-themes',
    '../../../@storybook/addon-styling-webpack'
  ],
  core: {
    builder: 'webpack5',
  },
  framework: {
    name: '@storybook/html-webpack5',
    options: {},
  },
  docs: {
    autodocs: false,
  },
  managerHead: (head) => `
    ${head}
    <style>
      :root {
        --colors-emulsify-blue-100: #e6f5fc;
        --colors-emulsify-blue-200: #CCECFA;
        --colors-emulsify-blue-300: #99D9F4;
        --colors-emulsify-blue-400: #66c5ef;
        --colors-emulsify-blue-500: #33b2e9;
        --colors-emulsify-blue-600: #009fe4;
        --colors-emulsify-blue-700: #007FB6;
        --colors-emulsify-blue-800: #005f89;
        --colors-emulsify-blue-900: #00405b;
        --colors-emulsify-blue-1000: #00202e;
        --colors-purple: #8B1E7E;
      }

      .sidebar-container {
        background: url('https://raw.githubusercontent.com/fourkitchens/emulsify-core/main/assets/images/corner-bkg.png?token=GHSAT0AAAAAACIEXLVDMX56QK3ZIZWHWHTEZNYFYIA') no-repeat top left;
      }

      .sidebar-container .sidebar-subheading {
        color: var(--colors-emulsify-blue-200);
        font-size: 13px;
        letter-spacing: 0.15em;
      }

      .sidebar-container .sidebar-subheading button:focus {
        color: var(--colors-emulsify-blue-300);
      }

      /** Triangle icon **/
      .sidebar-container .sidebar-subheading button span {
        color: var(--colors-emulsify-blue-300);
      }

      .sidebar-container .search-field input {
        border-color: var(--colors-emulsify-blue-700);
      }

      .sidebar-container .search-field input:active {
        border-color: var(--colors-emulsify-blue-700);
      }

      .sidebar-container .search-result-recentlyOpened,
      .sidebar-container .search-result-back,
      .sidebar-container .search-result-clearHistory {
        color: var(--colors-emulsify-blue-300) !important;
        letter-spacing: 0.15em;
      }

      .sidebar-container .search-result-back span,
      .sidebar-container .search-result-back svg,
      .sidebar-container .search-result-clearHistory span,
      .sidebar-container .search-result-clearHistory svg {
        letter-spacing: normal;
        color: white;
      }

      .sidebar-container .sidebar-item svg {
        margin-top: 1px;
      }

      .sidebar-container .sidebar-item span {
        margin-top: 4px;
      }

      .sidebar-container .sidebar-subheading-action svg {
        color: var(--colors-emulsify-blue-400);
      }

      .sidebar-container .sidebar-subheading-action:hover svg {
        color: var(--colors-emulsify-blue-300);
      }

      .sidebar-header button[title="Shortcuts"] {
        box-shadow: none;
        border: 1px solid var(--colors-emulsify-blue-700);
      }

      .sidebar-header button[title="Shortcuts"]:active {
        border: 1px solid var(--colors-emulsify-blue-500);
      }

      .sidebar-header button[title="Shortcuts"]:focus {
        background: transparent;
      }

      #shortcuts {
        border-bottom-color: var(--colors-emulsify-blue-900) !important;
      }

      [role="main"]:not(:nth-child(3)) {
        top: 1rem !important;
        height: calc(100vh - 2rem) !important;
      }

      [role="main"] .os-host .os-content button:hover {
        background: var(--colors-emulsify-blue-100);
      }

      [role="main"] .os-host .os-content button:hover svg {
        color: var(--colors-emulsify-blue-900);
      }

      #panel-tab-content,
      #panel-tab-content>* {
        color: var(--colors-emulsify-blue-100) !important;
      }

      #panel-tab-content a,
      #panel-tab-content a span,
      #panel-tab-content a span svg {
        color: var(--colors-emulsify-blue-800);
      }

      #panel-tab-content>div>div>div>div>div>div {
        background: transparent;
      }

      #panel-tab-content>div>div>div>div>div>div>div {
        color: var(--colors-emulsify-blue-1000) !important;
      }
    </style>
  `,
  ...safeConfigOverrides,
};

module.exports = config;
