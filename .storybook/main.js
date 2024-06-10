module.exports = {
  stories: [
    '../../../../components/**/*.stories.@(js|jsx|ts|tsx)',
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
    autodocs: true,
  },
};
