import React from 'react';
import { renderTwig } from '@emulsify/core/storybook';
import template from './card.twig';

export default {
  title: 'Fixtures/Mixed Storybook',
};

export const TwigCard = {
  render: renderTwig(template),
  args: {
    heading: 'Twig fixture',
    body: 'Rendered through the public Storybook helper.',
    variant: 'featured',
  },
};

export const ReactCard = {
  render: ({ heading, body }) =>
    React.createElement(
      'article',
      { className: 'react-card' },
      React.createElement('h2', null, heading),
      React.createElement('p', null, body),
    ),
  args: {
    heading: 'React fixture',
    body: 'Rendered as a regular React story.',
  },
};

export const LegacyTwigCard = ({ heading, body, variant }) =>
  template({
    heading,
    body,
    variant,
  });

LegacyTwigCard.args = {
  heading: 'Legacy Twig fixture',
  body: 'Rendered through the compatibility decorator.',
  variant: 'standard',
};
