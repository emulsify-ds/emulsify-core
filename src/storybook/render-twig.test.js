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

describe('renderTwig', () => {
  let container;
  let root;

  beforeAll(() => {
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

  it('does not create or require Drupal globals for generic platforms', () => {
    globalThis.__EMULSIFY_ENV__ = {
      platformAdapter: {
        storybook: {
          attachDrupalBehaviors: false,
        },
      },
    };
    const storyRender = renderTwig(() => '<section>Generic</section>');

    act(() => {
      root.render(storyRender({}));
    });

    expect(window.Drupal).toBeUndefined();
    expect(container.textContent).toBe('Generic');
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

  it('does not interfere with normal React story rendering', () => {
    const ReactStory = ({ label }) =>
      React.createElement('button', { type: 'button' }, label);

    act(() => {
      root.render(React.createElement(ReactStory, { label: 'React story' }));
    });

    expect(container.querySelector('button').textContent).toBe('React story');
  });
});
