/**
 * @file Storybook smoke stories covering Twig and React renderers together.
 */

import React from 'react';
import { renderTwig } from '@emulsify/core/storybook';
import template from './mixed-card.twig';

export default {
  title: 'Examples/Mixed Renderers',
};

export const TwigCard = {
  render: renderTwig(template),
  args: {
    heading: 'Twig card',
    body: 'Rendered through @emulsify/core/storybook.',
    variant: 'featured',
  },
};

export const ReactCard = {
  render: ({ heading, body }) =>
    React.createElement(
      'article',
      { 'data-renderer': 'react' },
      React.createElement('h2', null, heading),
      React.createElement('p', null, body),
    ),
  args: {
    heading: 'React card',
    body: 'Rendered as a normal React story.',
  },
};
