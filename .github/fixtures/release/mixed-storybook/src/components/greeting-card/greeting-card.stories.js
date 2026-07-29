import {
  defineCustomElement,
  renderWebComponent,
} from '@emulsify/core/storybook';
import { fn } from 'storybook/test';
import { GreetingCardElement } from './greeting-card.js';

defineCustomElement('fixture-greeting-card', GreetingCardElement);

const onGreetingSelect = fn((event) => {
  const element = event.currentTarget;
  element.dataset.eventCount = String(
    Number(element.dataset.eventCount || 0) + 1,
  );
  element.dataset.eventIsCustom = String(event instanceof CustomEvent);
  element.dataset.eventHeading = event.detail.heading;
});

const propertyRenderer = renderWebComponent('fixture-greeting-card', {
  className: 'fixture-custom-element-story',
  events: {
    'greeting-select': 'onGreetingSelect',
  },
});

const attributeRenderer = renderWebComponent('fixture-greeting-card', {
  argsAs: 'attributes',
  className: 'fixture-custom-element-story',
  events: {
    'greeting-select': 'onGreetingSelect',
  },
});

export default {
  id: 'fixtures-mixed-storybook-custom-element',
  title: 'Fixtures/Mixed Storybook/Custom Element',
  argTypes: {
    body: {
      control: 'text',
    },
    children: {
      control: 'text',
    },
    featured: {
      control: 'boolean',
    },
    heading: {
      control: 'text',
    },
    items: {
      control: 'object',
    },
    onGreetingSelect: {
      control: false,
      table: {
        disable: true,
      },
    },
    optionalNote: {
      control: 'text',
    },
  },
};

export const CustomElementCard = {
  render: propertyRenderer,
  args: {
    heading: 'Custom element fixture',
    body: 'Rendered as a vanilla custom element.',
    children: 'Default slot content',
    featured: true,
    items: [{ label: 'Alpha' }, { label: 'Beta' }],
    onGreetingSelect,
  },
};

export const AttributeMode = {
  render: attributeRenderer,
  args: {
    children: 'Attribute mode slot content',
    featured: false,
    heading: 'Attribute mode fixture',
  },
  argTypes: {
    body: {
      table: {
        disable: true,
      },
    },
    items: {
      table: {
        disable: true,
      },
    },
    optionalNote: {
      table: {
        disable: true,
      },
    },
  },
};
