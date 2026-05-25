/**
 * @file Tests for the Storybook Twig source() runtime helper.
 */

import { createTwigSourceFunction, resolveAssetSource } from './source.js';

describe('Twig source() Storybook helper', () => {
  let consoleError;

  beforeEach(() => {
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it('returns raw Twig source from the template resolver', () => {
    const source = createTwigSourceFunction((name) =>
      name === '@components/button/button.twig'
        ? '<button>{{ text }}</button>'
        : undefined,
    );

    expect(source('@components/button/button.twig')).toBe(
      '<button>{{ text }}</button>',
    );
  });

  it('resolves raster assets to public Storybook image markup', () => {
    expect(resolveAssetSource('@assets/icons/arrow.png')).toBe(
      '<img src="/assets/icons/arrow.png" alt="" role="img">',
    );
  });

  it('returns a public URL for non-inline, non-image assets', () => {
    expect(resolveAssetSource('@assets/fonts/icon.woff2')).toBe(
      '/assets/fonts/icon.woff2',
    );
  });

  it('returns an empty string for ignored missing template source', () => {
    const source = createTwigSourceFunction(() => undefined);

    expect(source('@components/missing.twig', true)).toBe('');
    expect(consoleError).not.toHaveBeenCalled();
  });
});
