import {
  defineCustomElement,
  renderWebComponent,
} from '@emulsify/core/storybook';
import { fn } from 'storybook/test';
import { GreetingCardElement } from './greeting-card.js';

defineCustomElement('fixture-greeting-card', GreetingCardElement);

export default {
  title: 'Fixtures/Mixed Storybook/Custom Element',
  render: renderWebComponent('fixture-greeting-card', {
    className: 'fixture-custom-element-story',
    events: {
      'greeting-select': 'onGreetingSelect',
    },
  }),
};

export const CustomElementCard = {
  args: {
    heading: 'Custom element fixture',
    body: 'Rendered as a vanilla custom element.',
    children: 'Default slot content',
    featured: true,
    onGreetingSelect: fn(),
  },
};
