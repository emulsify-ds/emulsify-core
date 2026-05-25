import { renderTwig } from '@emulsify/core/storybook';
import template from './gallery.twig';

export default {
  title: 'Fixtures/Large Twig Storybook',
};

export const Default = {
  render: renderTwig(template),
  args: {
    heading: 'Large Twig fixture',
  },
};
