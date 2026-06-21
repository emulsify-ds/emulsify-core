/**
 * @file Tests for the public Twig Storybook renderer.
 */

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import {
  renderHtmlStoryResult,
  renderTwig,
  renderTwigHtml,
} from '@emulsify/core/storybook';
import {
  legacyStringFromElement,
  withLegacyStoryToString,
} from './render-twig.js';
import { TWIG_SOURCE_LOADED_EVENT } from './twig/source-events.js';

describe('renderTwig', () => {
  let container;
  let root;

  beforeAll(() => {
    /**
     * Tell React that this jsdom suite intentionally wraps renders in act().
     *
     * React 18 prints warnings without this flag when tests use createRoot().
     */
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    delete globalThis.__EMULSIFY_ENV__;
    delete window.Drupal;
    delete window.drupalSettings;
  });

  it('renders Twig HTML from Storybook args', () => {
    const template = ({ heading }) => `<article><h2>${heading}</h2></article>`;
    const storyRender = renderTwig(template);

    act(() => {
      root.render(storyRender({ heading: 'Example' }));
    });

    expect(container.querySelector('h2').textContent).toBe('Example');
  });

  it('supports default-level Storybook render functions with context mapping', () => {
    const template = ({ heading, renderedBy }) =>
      `<article data-rendered-by="${renderedBy}"><h2>${heading}</h2></article>`;
    const storyRender = renderTwig(template, {
      context: (args, storyContext) => ({
        ...args,
        renderedBy: storyContext.name,
      }),
    });

    act(() => {
      root.render(storyRender({ heading: 'Default render' }, { name: 'CSF3' }));
    });

    expect(container.querySelector('h2').textContent).toBe('Default render');
    expect(container.querySelector('article').dataset.renderedBy).toBe('CSF3');
  });

  it('re-renders when args change', () => {
    const template = ({ heading }) => `<h2>${heading}</h2>`;
    const storyRender = renderTwig(template);

    act(() => {
      root.render(storyRender({ heading: 'First' }));
    });
    act(() => {
      root.render(storyRender({ heading: 'Second' }));
    });

    expect(container.querySelector('h2').textContent).toBe('Second');
  });

  it('re-renders when lazy Twig source text finishes loading', async () => {
    let sourceLoaded = false;
    const template = () =>
      `<p>${sourceLoaded ? 'Loaded source' : 'Loading source'}</p>`;
    const storyRender = renderTwig(template);

    await act(async () => {
      root.render(storyRender({}));
    });
    sourceLoaded = true;
    await act(async () => {
      window.dispatchEvent(new CustomEvent(TWIG_SOURCE_LOADED_EVENT));
    });

    expect(container.querySelector('p').textContent).toBe('Loaded source');
  });

  it('calls Drupal attachBehaviors only when the platform adapter enables it', async () => {
    globalThis.__EMULSIFY_ENV__ = {
      platformAdapter: {
        storybook: {
          attachDrupalBehaviors: true,
        },
      },
    };
    window.Drupal = {
      attachBehaviors: jest.fn(),
    };
    const storyRender = renderTwig(() => '<section>Drupal</section>');

    await act(async () => {
      root.render(storyRender({}));
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(window.Drupal.attachBehaviors).toHaveBeenCalledTimes(1);
    expect(
      window.Drupal.attachBehaviors.mock.calls[0][0].hasAttribute(
        'data-emulsify-twig-story',
      ),
    ).toBe(true);
  });

  it('does not create or require Drupal globals for none platforms', () => {
    globalThis.__EMULSIFY_ENV__ = {
      platformAdapter: {
        storybook: {
          attachDrupalBehaviors: false,
        },
      },
    };
    const storyRender = renderTwig(() => '<section>None</section>');

    act(() => {
      root.render(storyRender({}));
    });

    expect(window.Drupal).toBeUndefined();
    expect(container.textContent).toBe('None');
  });

  it('renders legacy Twig HTML strings through the shared wrapper', () => {
    act(() => {
      root.render(renderTwigHtml('<article><h2>Legacy Twig</h2></article>'));
    });

    expect(container.querySelector('h2').textContent).toBe('Legacy Twig');
    expect(
      container
        .querySelector('[data-emulsify-twig-story]')
        .hasAttribute('data-emulsify-twig-story'),
    ).toBe(true);
  });

  it('converts string story results while preserving React story results', () => {
    const ReactResult = React.createElement(
      'button',
      { type: 'button' },
      'React story',
    );

    act(() => {
      root.render(renderHtmlStoryResult('<p>Legacy string</p>'));
    });

    expect(container.querySelector('p').textContent).toBe('Legacy string');
    expect(renderHtmlStoryResult(ReactResult)).toBe(ReactResult);
  });

  it('extracts HTML from legacy story elements with custom stringification', () => {
    const HtmlStoryElement = withLegacyStoryToString(
      React.createElement('div', null, 'React wrapper'),
      () => '<article><h2>Legacy React text</h2></article>',
    );
    const PlainElement = React.createElement('div', null, 'React wrapper');
    const NonHtmlElement = withLegacyStoryToString(
      React.createElement('div', null, 'React wrapper'),
      () => 'Plain text',
    );

    expect(legacyStringFromElement('<p>Plain string</p>')).toBeUndefined();
    expect(legacyStringFromElement(PlainElement)).toBeUndefined();
    expect(legacyStringFromElement(HtmlStoryElement)).toBe(
      '<article><h2>Legacy React text</h2></article>',
    );
    expect(legacyStringFromElement(NonHtmlElement)).toBeUndefined();
  });

  it('preserves HTML for legacy decorators that stringify story results', () => {
    const storyElement = withLegacyStoryToString(
      React.createElement('div', null, 'React wrapper'),
      () => '<p>Stringified Twig</p>',
    );

    act(() => {
      root.render(renderHtmlStoryResult(`${storyElement}`));
    });

    expect(container.querySelector('p').textContent).toBe('Stringified Twig');
  });

  it('renders legacy story elements through the shared HTML wrapper', () => {
    const storyElement = withLegacyStoryToString(
      React.createElement('div', null, 'React wrapper'),
      () => '<strong>Renderable clone</strong>',
    );

    act(() => {
      root.render(renderHtmlStoryResult(storyElement));
    });

    expect(container.querySelector('strong').textContent).toBe(
      'Renderable clone',
    );
  });

  it('updates legacy string story markup when args change', () => {
    const LegacyStory = ({ heading }) =>
      `<article><h2>${heading}</h2></article>`;
    /**
     * Exercise the same shape produced by the Storybook preview decorator:
     * a React story element with legacy stringification, then HTML routing.
     */
    const PreviewDecoratorResult = ({ heading }) =>
      renderHtmlStoryResult(
        withLegacyStoryToString(
          React.createElement(LegacyStory, { heading }),
          () => LegacyStory({ heading }),
        ),
      );

    act(() => {
      root.render(
        React.createElement(PreviewDecoratorResult, {
          heading: 'First',
        }),
      );
    });
    const firstHtml = container.innerHTML;

    act(() => {
      root.render(
        React.createElement(PreviewDecoratorResult, {
          heading: 'Second',
        }),
      );
    });

    expect(firstHtml).toContain('First');
    expect(container.innerHTML).toContain('Second');
    expect(container.innerHTML).not.toBe(firstHtml);
  });

  it('does not interfere with normal React story rendering', () => {
    const ReactStory = ({ label }) =>
      React.createElement('button', { type: 'button' }, label);

    act(() => {
      root.render(React.createElement(ReactStory, { label: 'React story' }));
    });

    expect(container.querySelector('button').textContent).toBe('React story');
  });
});
