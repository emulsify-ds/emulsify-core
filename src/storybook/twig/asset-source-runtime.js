/**
 * @file Shared runtime for virtual Twig source() text assets.
 */

const collectionHas = (values, value) =>
  typeof values?.has === 'function'
    ? values.has(value)
    : Array.isArray(values) && values.includes(value);

const collectionLength = (values) =>
  typeof values?.size === 'number' ? values.size : values?.length || 0;

const unique = (values) => Array.from(new Set(values.filter(Boolean)));

/**
 * Normalize a Twig asset reference to a root-relative asset key segment.
 *
 * @param {string} assetPath - Twig asset reference.
 * @returns {string} Normalized asset path without @assets or leading slash.
 */
export const normalizeAssetPath = (assetPath) =>
  String(assetPath || '')
    .replace(/^@assets\//, '')
    .replace(/^\/?assets\//, '')
    .replace(/^\/+/, '');

/**
 * Build the virtual source-map keys that can satisfy one asset reference.
 *
 * @param {string} assetPath - Twig asset reference.
 * @param {{ assetRootPrefixes?: string[], generatedAssetRootPrefixes?: string[], generatedAssetAliases?: string[]|Set<string> }} [options={}] - Runtime key state.
 * @returns {string[]} Candidate keys in lookup order.
 */
export function candidateKeysForAssetPath(
  assetPath,
  {
    assetRootPrefixes = [],
    generatedAssetRootPrefixes = [],
    generatedAssetAliases = [],
  } = {},
) {
  const rawPath = String(assetPath || '');
  const normalized = normalizeAssetPath(rawPath);
  const directPath = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
  const generatedCandidates = collectionHas(generatedAssetAliases, normalized)
    ? generatedAssetRootPrefixes.map(
        (root) => `${root.replace(/\/+$/, '')}/${normalized}`,
      )
    : [];

  return unique([
    rawPath,
    directPath,
    normalized ? `/${normalized}` : '',
    ...generatedCandidates,
    ...assetRootPrefixes.map(
      (root) => `${root.replace(/\/+$/, '')}/${normalized}`,
    ),
  ]);
}

/**
 * Find the source-map key that resolves one asset reference.
 *
 * @param {string} assetPath - Twig asset reference.
 * @param {{ assets?: Record<string, unknown>, assetRootPrefixes?: string[], generatedAssetRootPrefixes?: string[], generatedAssetAliases?: string[]|Set<string> }} [options={}] - Runtime key state.
 * @returns {string|undefined} Matching source-map key.
 */
export function findAssetKey(assetPath, options = {}) {
  const { assets = {} } = options;

  return candidateKeysForAssetPath(assetPath, options).find((key) =>
    Object.hasOwnProperty.call(assets, key),
  );
}

const normalizeSourceText = (value) => {
  const source = value?.default ?? value;
  return typeof source === 'string' ? source : undefined;
};

const reportAssetLoadError = (key, error) => {
  if (typeof console !== 'undefined' && typeof console.error === 'function') {
    console.error(`source(): failed to load asset ${key}`, error);
  }
};

/**
 * Create the synchronous facade around lazy virtual asset source imports.
 *
 * @param {{
 *   assets?: Record<string, unknown>,
 *   assetRootPrefixes?: string[],
 *   generatedAssetRootPrefixes?: string[],
 *   generatedAssetAliases?: string[]|Set<string>,
 *   onLoadError?: Function
 * }} [state={}] - Runtime source-map state.
 * @returns {{ coversAssetPath: Function, hasAssetText: Function, isAssetTextLoading: Function, whenAssetTextLoaded: Function, getAssetText: Function, clearAssetTextCache: Function }} Runtime helpers.
 */
export function createAssetSourceRuntime(state = {}) {
  const {
    assets = {},
    assetRootPrefixes = [],
    generatedAssetRootPrefixes = [],
    generatedAssetAliases = [],
    onLoadError = reportAssetLoadError,
  } = state;
  const sourceTextCache = new Map();
  const sourceLoadPromises = new Map();
  const keyState = {
    assets,
    assetRootPrefixes,
    generatedAssetRootPrefixes,
    generatedAssetAliases,
  };
  const findKey = (assetPath) => findAssetKey(assetPath, keyState);

  const coversAssetPath = (assetPath) =>
    (collectionLength(assetRootPrefixes) > 0 ||
      collectionLength(generatedAssetRootPrefixes) > 0) &&
    normalizeAssetPath(assetPath).length > 0;

  const hasAssetText = (assetPath) => Boolean(findKey(assetPath));

  const isAssetTextLoading = (assetPath) => {
    const key = findKey(assetPath);
    return Boolean(key && sourceLoadPromises.has(key));
  };

  const whenAssetTextLoaded = (assetPath) => {
    const key = findKey(assetPath);
    return key ? sourceLoadPromises.get(key) : undefined;
  };

  const getAssetText = (assetPath) => {
    const key = findKey(assetPath);
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
      let loadedSource;
      try {
        loadedSource = loader();
      } catch (error) {
        loadedSource = Promise.reject(error);
      }

      const sourceLoad = Promise.resolve(loadedSource)
        .then((loaded) => {
          const loadedText = normalizeSourceText(loaded);
          if (typeof loadedText === 'string') {
            sourceTextCache.set(key, loadedText);
          }
          return loadedText;
        })
        .catch((error) => {
          onLoadError(key, error);
          return undefined;
        })
        .finally(() => {
          sourceLoadPromises.delete(key);
        });

      sourceLoadPromises.set(key, sourceLoad);
    }

    return undefined;
  };

  const clearAssetTextCache = () => {
    sourceTextCache.clear();
    sourceLoadPromises.clear();
  };

  return {
    coversAssetPath,
    hasAssetText,
    isAssetTextLoading,
    whenAssetTextLoaded,
    getAssetText,
    clearAssetTextCache,
  };
}
