import { renderTwig } from '@emulsify/core/storybook';
import template from './card.twig';

export default {
  title: 'Fixtures/Consumer Whisk',
};

export const TwigCard = {
  render: renderTwig(template),
  args: {
    heading: 'Packed Whisk fixture',
    content: 'Rendered with the installed Core package.',
  },
};
