/**
 * @file Tests for the Storybook Twig source() runtime helper.
 */

import { createTwigSourceFunction, resolveAssetSource } from './source.js';
import { TWIG_SOURCE_LOADED_EVENT } from './source-events.js';
import {
  resetVirtualTwigAssetSources,
  setVirtualTwigAssetSources,
} from 'virtual:emulsify-twig-asset-sources';

describe('Twig source() Storybook helper', () => {
  let consoleError;
  let consoleWarn;
  let originalXmlHttpRequest;

  beforeEach(() => {
    resetVirtualTwigAssetSources();
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    originalXmlHttpRequest = globalThis.XMLHttpRequest;
  });

  afterEach(() => {
    consoleError.mockRestore();
    consoleWarn.mockRestore();
    globalThis.XMLHttpRequest = originalXmlHttpRequest;
    delete globalThis.__EMULSIFY_ENV__;
    resetVirtualTwigAssetSources();
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

  it('returns cached raw asset source after a lazy asset load resolves', async () => {
    const assetLoad = jest.fn(() => Promise.resolve('<svg></svg>'));
    setVirtualTwigAssetSources(
      {
        '/assets/icons/source-test.svg': assetLoad,
      },
      ['/assets/'],
    );
    const source = createTwigSourceFunction(() => undefined);
    const sourceLoaded = new Promise((resolve) => {
      window.addEventListener(TWIG_SOURCE_LOADED_EVENT, resolve, {
        once: true,
      });
    });

    expect(source('@assets/icons/source-test.svg')).toBe('');
    expect(assetLoad).toHaveBeenCalledTimes(1);
    await sourceLoaded;

    expect(source('@assets/icons/source-test.svg')).toBe('<svg></svg>');
    expect(assetLoad).toHaveBeenCalledTimes(1);
    expect(consoleWarn).not.toHaveBeenCalled();
  });

  it('does not use sync XHR for missing text assets by default', () => {
    globalThis.XMLHttpRequest = jest.fn();
    const source = createTwigSourceFunction(() => undefined);

    expect(source('@assets/icons/no-sync-xhr.svg')).toBe('');
    expect(globalThis.XMLHttpRequest).not.toHaveBeenCalled();
    expect(consoleWarn).toHaveBeenCalledWith(
      expect.stringContaining(
        'Synchronous XHR fallback is disabled by default',
      ),
    );
  });

  it('keeps sync XHR as an explicit opt-in fallback for uncovered text assets', () => {
    const xhr = {
      open: jest.fn(),
      send: jest.fn(function send() {
        xhr.status = 200;
        xhr.responseText = '<svg>legacy</svg>';
      }),
      status: 0,
      responseText: '',
    };
    globalThis.XMLHttpRequest = jest.fn(() => xhr);
    globalThis.__EMULSIFY_ENV__ = {
      platformAdapter: {
        storybook: {
          allowSyncXhrSource: true,
        },
      },
    };

    expect(resolveAssetSource('@assets/icons/legacy-xhr.svg')).toBe(
      '<svg>legacy</svg>',
    );
    expect(xhr.open).toHaveBeenCalledWith(
      'GET',
      '/assets/icons/legacy-xhr.svg',
      false,
    );
    expect(consoleWarn).not.toHaveBeenCalled();
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
