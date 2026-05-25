/**
 * @file Tests for the Storybook Twig include() runtime helper.
 */

import { createTwigIncludeFunction } from './include.js';

describe('Twig include() Storybook helper', () => {
  let consoleError;

  beforeEach(() => {
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it('renders the resolved template with explicit variables', () => {
    const template = jest.fn(({ text }) => `<span>${text}</span>`);
    const include = createTwigIncludeFunction(() => template);

    expect(include('@components/button', { text: 'Read more' })).toBe(
      '<span>Read more</span>',
    );
    expect(template).toHaveBeenCalledWith({ text: 'Read more' });
  });

  it('can merge the current Twig context when with_context is enabled', () => {
    const template = jest.fn(
      ({ theme, text }) => `<span class="${theme}">${text}</span>`,
    );
    const include = createTwigIncludeFunction(() => template);

    expect(
      include.call(
        { context: { theme: 'dark' } },
        '@components/button',
        { text: 'Read more' },
        true,
      ),
    ).toBe('<span class="dark">Read more</span>');
    expect(template).toHaveBeenCalledWith({
      theme: 'dark',
      text: 'Read more',
    });
  });

  it('supports options passed through the variables object', () => {
    const template = jest.fn(({ theme, text }) => `${theme}:${text}`);
    const include = createTwigIncludeFunction(() => template);

    expect(
      include.call({ context: { theme: 'light' } }, '@components/button', {
        text: 'Read more',
        with_context: true,
      }),
    ).toBe('light:Read more');
    expect(template).toHaveBeenCalledWith({
      theme: 'light',
      text: 'Read more',
    });
  });

  it('uses the first resolvable template from an ordered candidate list', () => {
    const template = jest.fn(() => '<span>Fallback</span>');
    const resolver = jest.fn((name) =>
      name === '@components/fallback' ? template : undefined,
    );
    const include = createTwigIncludeFunction(resolver);

    expect(include(['@components/missing', '@components/fallback'], {})).toBe(
      '<span>Fallback</span>',
    );
    expect(resolver).toHaveBeenCalledWith('@components/missing');
    expect(resolver).toHaveBeenCalledWith('@components/fallback');
  });

  it('returns an empty string for ignored missing templates', () => {
    const include = createTwigIncludeFunction(() => undefined);

    expect(include('@components/missing', { ignore_missing: true })).toBe('');
    expect(consoleError).not.toHaveBeenCalled();
  });
});
