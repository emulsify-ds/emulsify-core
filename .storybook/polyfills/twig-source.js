// Constants used by the `source()` polyfill.
const PUBLIC_ASSET_BASE = (typeof window !== 'undefined' && window.location && window.location.hostname === 'fourkitchens.github.io')
  ? '/bcj/assets/'
  : '/assets/';
const INLINE_ASSET_EXTS = new Set(['svg', 'html', 'twig', 'css', 'js', 'json', 'txt', 'md']);
const IMAGE_ASSET_EXTS  = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif']);

/**
 * Twig `source()` polyfill.
 * Returns an <img> tag or URL for @assets paths.
 * @param {string} assetPath
 * @return {string}
 */
function twigSource(Twig) {
  Twig.extendFunction('source', (assetPath) => {
    if (typeof assetPath !== 'string') return '';

    // Strip Drupal-style alias and extract file extension.
    const relPath = assetPath.replace(/^@assets\//, '');
    const extension = relPath.split('.').pop().toLowerCase();

    // Inline raw content for textual assets.
    if (INLINE_ASSET_EXTS.has(extension)) {
      try {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', `${PUBLIC_ASSET_BASE}${relPath}`, false); // synchronous
        xhr.send(null);
        if (xhr.status >= 200 && xhr.status < 300) {
          return xhr.responseText;
        }
        // eslint-disable-next-line no-console
        console.error(`source(): ${xhr.status} while fetching ${relPath}`);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`source(): failed to fetch ${relPath}`, err);
      }
    }

    // Auto-render raster images.
    if (IMAGE_ASSET_EXTS.has(extension)) {
      return `<img src="${PUBLIC_ASSET_BASE}${relPath}" alt="" role="img">`;
    }

    // Fallback: return public URL.
    return `${PUBLIC_ASSET_BASE}${relPath}`;
  });
};

export default twigSource;
