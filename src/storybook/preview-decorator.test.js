/**
 * @file Tests for Storybook preview decorator context forwarding.
 */

import React from 'react';
import {
  applyStoryDecorators,
  createStoryElement,
  renderPreviewStory,
} from './preview-decorator.js';

function makeStoryContext() {
  return {
    id: 'components-card--default',
    name: 'Default',
    viewMode: 'story',
    args: {
      label: 'Read more',
    },
    loaded: {
      card: {
        eyebrow: 'Loaded data',
      },
    },
    parameters: {
      layout: 'centered',
      variant: 'feature',
    },
    globals: {
      locale: 'en',
    },
  };
}

describe('Storybook preview decorator helpers', () => {
  const decorateStory = (baseStory, decorators) => (context) =>
    decorators.reduceRight(
      (Story, decorator) => () => decorator(Story, context),
      () => baseStory(context),
    )();

  it('passes full Storybook context as React story props', () => {
    const context = makeStoryContext();
    const Story = () => React.createElement('button', { type: 'button' });
    const element = createStoryElement(Story, context);

    expect(element.props).toMatchObject({
      id: context.id,
      name: context.name,
      args: context.args,
      loaded: context.loaded,
      parameters: context.parameters,
      globals: context.globals,
    });
  });

  it('preserves full context through Storybook decorators', () => {
    const context = makeStoryContext();
    const storyFn = () => React.createElement('span', null, 'Decorated story');
    const decorator = jest.fn((Story, storyContext) =>
      React.createElement(
        'section',
        {
          'data-variant': storyContext.parameters.variant,
          'data-loaded': storyContext.loaded.card.eyebrow,
        },
        Story(),
      ),
    );
    const decorated = applyStoryDecorators(decorateStory, storyFn, [decorator]);
    const result = decorated(context);
    const decoratedStoryElement = result.props.children;

    expect(decorator).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        id: context.id,
        loaded: context.loaded,
        parameters: context.parameters,
        globals: context.globals,
      }),
    );
    expect(result.props['data-variant']).toBe('feature');
    expect(result.props['data-loaded']).toBe('Loaded data');
    expect(decoratedStoryElement.props).toMatchObject({
      args: context.args,
      loaded: context.loaded,
      parameters: context.parameters,
      globals: context.globals,
    });
  });

  it('passes full context to decorated Story callbacks', () => {
    const context = makeStoryContext();
    const Story = jest.fn((storyContext) =>
      React.createElement(
        'output',
        {
          'data-story-id': storyContext.id,
          'data-loaded': storyContext.loaded.card.eyebrow,
          'data-variant': storyContext.parameters.variant,
        },
        storyContext.args.label,
      ),
    );

    const result = renderPreviewStory(Story, context);

    expect(Story).toHaveBeenCalledWith(context);
    expect(result.props).toMatchObject({
      'data-story-id': 'components-card--default',
      'data-loaded': 'Loaded data',
      'data-variant': 'feature',
      children: 'Read more',
    });
  });

  it('preserves React story results and wraps legacy Twig HTML strings', () => {
    const context = makeStoryContext();
    const reactElement = React.createElement('button', null, 'React story');
    const renderedReact = renderPreviewStory(() => reactElement, context);
    const renderedTwig = renderPreviewStory(
      () => '<article><h2>Legacy Twig</h2></article>',
      context,
    );

    expect(renderedReact).toBe(reactElement);
    expect(renderedTwig.props.html).toBe(
      '<article><h2>Legacy Twig</h2></article>',
    );
  });
});
