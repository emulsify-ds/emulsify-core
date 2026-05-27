/**
 * @file Jest stub for the Vite-only Twig text asset source virtual module.
 */

export const assets = {};
export const assetRootPrefixes = [];

const sourceTextCache = new Map();
const sourceLoadPromises = new Map();

const unique = (values) => Array.from(new Set(values.filter(Boolean)));

const normalizeAssetPath = (assetPath) =>
  String(assetPath || '')
    .replace(/^@assets\//, '')
    .replace(/^\/?assets\//, '')
    .replace(/^\/+/, '');

const candidateKeysForAssetPath = (assetPath) => {
  const rawPath = String(assetPath || '');
  const normalized = normalizeAssetPath(rawPath);
  const directPath = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;

  return unique([
    rawPath,
    directPath,
    normalized ? `/${normalized}` : '',
    ...assetRootPrefixes.map(
      (root) => `${root.replace(/\/+$/, '')}/${normalized}`,
    ),
  ]);
};

const findAssetKey = (assetPath) =>
  candidateKeysForAssetPath(assetPath).find((key) =>
    Object.hasOwnProperty.call(assets, key),
  );

const normalizeSourceText = (value) => {
  const source = value?.default ?? value;
  return typeof source === 'string' ? source : undefined;
};

export const coversAssetPath = (assetPath) =>
  assetRootPrefixes.length > 0 && normalizeAssetPath(assetPath).length > 0;

export const hasAssetText = (assetPath) => Boolean(findAssetKey(assetPath));

export const isAssetTextLoading = (assetPath) => {
  const key = findAssetKey(assetPath);
  return Boolean(key && sourceLoadPromises.has(key));
};

export const whenAssetTextLoaded = (assetPath) => {
  const key = findAssetKey(assetPath);
  return key ? sourceLoadPromises.get(key) : undefined;
};

export const getAssetText = (assetPath) => {
  const key = findAssetKey(assetPath);
  if (!key) return undefined;
  if (sourceTextCache.has(key)) {
    return sourceTextCache.get(key);
  }

  const loader = assets[key];
  const sourceText = normalizeSourceText(loader);
  if (typeof sourceText === 'string') {
    sourceTextCache.set(key, sourceText);
    return sourceText;
  }

  if (typeof loader === 'function' && !sourceLoadPromises.has(key)) {
    const sourceLoad = Promise.resolve(loader())
      .then((loaded) => {
        const loadedText = normalizeSourceText(loaded);
        if (typeof loadedText === 'string') {
          sourceTextCache.set(key, loadedText);
        }
        return loadedText;
      })
      .finally(() => {
        sourceLoadPromises.delete(key);
      });

    sourceLoadPromises.set(key, sourceLoad);
  }

  return undefined;
};

export function setVirtualTwigAssetSources(nextAssets = {}, roots = []) {
  for (const key of Object.keys(assets)) {
    delete assets[key];
  }
  Object.assign(assets, nextAssets);

  assetRootPrefixes.splice(0, assetRootPrefixes.length, ...roots);
  sourceTextCache.clear();
  sourceLoadPromises.clear();
}

export function resetVirtualTwigAssetSources() {
  setVirtualTwigAssetSources();
}
