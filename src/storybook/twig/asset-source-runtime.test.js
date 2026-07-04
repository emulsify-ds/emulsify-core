/**
 * @file Tests for shared Twig asset source runtime helpers.
 */

import {
  candidateKeysForAssetPath,
  createAssetSourceRuntime,
  findAssetKey,
  normalizeAssetPath,
} from './asset-source-runtime.js';

describe('Twig asset source runtime', () => {
  it('normalizes asset references and builds lookup candidates', () => {
    expect(normalizeAssetPath('@assets/icons/arrow.svg')).toBe(
      'icons/arrow.svg',
    );
    expect(normalizeAssetPath('/assets/icons/arrow.svg')).toBe(
      'icons/arrow.svg',
    );

    expect(
      candidateKeysForAssetPath('@assets/icons.svg', {
        assetRootPrefixes: ['/assets/'],
        generatedAssetRootPrefixes: ['/dist/assets/'],
        generatedAssetAliases: ['icons.svg'],
      }),
    ).toEqual([
      '@assets/icons.svg',
      '/@assets/icons.svg',
      '/icons.svg',
      '/dist/assets/icons.svg',
      '/assets/icons.svg',
    ]);
  });

  it('prefers generated asset aliases before project root assets', () => {
    const assets = {
      '/assets/icons.svg': '<svg>root</svg>',
      '/dist/assets/icons.svg': '<svg>sprite</svg>',
    };
    const runtime = createAssetSourceRuntime({
      assets,
      assetRootPrefixes: ['/assets/'],
      generatedAssetRootPrefixes: ['/dist/assets/'],
      generatedAssetAliases: ['icons.svg'],
    });

    expect(
      findAssetKey('@assets/icons.svg', {
        assets,
        assetRootPrefixes: ['/assets/'],
        generatedAssetRootPrefixes: ['/dist/assets/'],
        generatedAssetAliases: ['icons.svg'],
      }),
    ).toBe('/dist/assets/icons.svg');
    expect(runtime.getAssetText('@assets/icons.svg')).toBe('<svg>sprite</svg>');
  });

  it('caches lazy source imports and clears cache on reset', async () => {
    const loader = jest.fn(() =>
      Promise.resolve({ default: '<svg>lazy</svg>' }),
    );
    const runtime = createAssetSourceRuntime({
      assets: {
        '/assets/icons/lazy.svg': loader,
      },
      assetRootPrefixes: ['/assets/'],
    });

    expect(runtime.getAssetText('@assets/icons/lazy.svg')).toBeUndefined();
    expect(runtime.isAssetTextLoading('@assets/icons/lazy.svg')).toBe(true);
    await expect(
      runtime.whenAssetTextLoaded('@assets/icons/lazy.svg'),
    ).resolves.toBe('<svg>lazy</svg>');

    expect(runtime.getAssetText('@assets/icons/lazy.svg')).toBe(
      '<svg>lazy</svg>',
    );
    expect(loader).toHaveBeenCalledTimes(1);

    runtime.clearAssetTextCache();
    expect(runtime.getAssetText('@assets/icons/lazy.svg')).toBeUndefined();
    expect(loader).toHaveBeenCalledTimes(2);
    await expect(
      runtime.whenAssetTextLoaded('@assets/icons/lazy.svg'),
    ).resolves.toBe('<svg>lazy</svg>');
  });
});
