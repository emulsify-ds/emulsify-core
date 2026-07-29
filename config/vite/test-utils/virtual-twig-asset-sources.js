/**
 * @file Jest stub for the Vite-only Twig text asset source virtual module.
 */

import { createAssetSourceRuntime } from '../../../src/storybook/twig/asset-source-runtime.js';

export const assets = {};
export const assetRootPrefixes = [];
export const generatedAssetRootPrefixes = [];
export const generatedAssetAliases = ['icons.svg'];

const assetSourceRuntime = createAssetSourceRuntime({
  assets,
  assetRootPrefixes,
  generatedAssetRootPrefixes,
  generatedAssetAliases,
});

export const coversAssetPath = assetSourceRuntime.coversAssetPath;
export const hasAssetText = assetSourceRuntime.hasAssetText;
export const isAssetTextLoading = assetSourceRuntime.isAssetTextLoading;
export const whenAssetTextLoaded = assetSourceRuntime.whenAssetTextLoaded;
export const getAssetText = assetSourceRuntime.getAssetText;

export function setVirtualTwigAssetSources(
  nextAssets = {},
  roots = [],
  generatedRoots = [],
) {
  for (const key of Object.keys(assets)) {
    delete assets[key];
  }
  Object.assign(assets, nextAssets);

  assetRootPrefixes.splice(0, assetRootPrefixes.length, ...roots);
  generatedAssetRootPrefixes.splice(
    0,
    generatedAssetRootPrefixes.length,
    ...generatedRoots,
  );
  assetSourceRuntime.clearAssetTextCache();
}

export function resetVirtualTwigAssetSources() {
  setVirtualTwigAssetSources();
}
