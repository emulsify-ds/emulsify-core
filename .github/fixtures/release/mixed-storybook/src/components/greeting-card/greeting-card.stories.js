import { defineComponent, renderWebComponent } from '@emulsify/core/storybook';
import { GreetingCardElement } from './greeting-card.js';

defineComponent('fixture-greeting-card', GreetingCardElement);

export default {
  title: 'Fixtures/Mixed Storybook/Web Component',
  render: renderWebComponent('fixture-greeting-card', {
    className: 'fixture-web-component-story',
  }),
};

export const WebComponentCard = {
  args: {
    heading: 'Web component fixture',
    body: 'Rendered as a vanilla custom element.',
    featured: true,
  },
};
