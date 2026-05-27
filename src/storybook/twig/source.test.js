/**
 * @file Tests for the Storybook Twig source() runtime helper.
 */

import { createTwigSourceFunction, resolveAssetSource } from './source.js';
import { TWIG_SOURCE_LOADED_EVENT } from './source-events.js';

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

  it('returns cached raw Twig source after a lazy source load resolves', async () => {
    const sourceLoad = Promise.resolve('<button>{{ text }}</button>');
    const templateSourceResolver = jest
      .fn()
      .mockReturnValueOnce(undefined)
      .mockReturnValue('<button>{{ text }}</button>');
    templateSourceResolver.isTemplateSourceLoading = jest
      .fn()
      .mockReturnValue(true);
    templateSourceResolver.whenTemplateSourceLoaded = jest
      .fn()
      .mockReturnValue(sourceLoad);
    const source = createTwigSourceFunction(templateSourceResolver);
    const sourceLoaded = new Promise((resolve) => {
      window.addEventListener(TWIG_SOURCE_LOADED_EVENT, resolve, {
        once: true,
      });
    });

    expect(source('@components/button/button.twig')).toBe('');
    await sourceLoaded;

    expect(source('@components/button/button.twig')).toBe(
      '<button>{{ text }}</button>',
    );
    expect(consoleError).not.toHaveBeenCalled();
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
