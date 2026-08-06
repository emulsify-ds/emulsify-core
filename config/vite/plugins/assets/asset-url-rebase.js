/**
 * @file CSS asset URL rebasing.
 *
 * Pure decision logic for repairing CSS `url()` references to project assets.
 * The Vite wiring lives in `css-asset-rebase.js`; keeping the rules here means
 * every branch is unit-testable without a build.
 *
 * ## The problem
 *
 * Emulsify's documented convention is a root-absolute `url('/assets/...')`
 * (docs/asset-references.md). Two other forms are common in the wild and both
 * ship broken:
 *
 * 1. A relative URL authored against the *emitted* CSS location rather than
 *    the stylesheet — `url('../../assets/images/x.jpg')`. Vite cannot resolve
 *    it, leaves it verbatim, and it is then re-anchored to wherever the CSS
 *    lands. Drupal SDC output sits two levels below the theme root, so the
 *    depth happens to work there and nowhere else.
 * 2. The bare `url('assets/images/x.jpg')` form. Vite treats it as a package
 *    specifier, fails to resolve it, and nothing ever emits the asset.
 *
 * A configured `assets.roots` entry hits the same wall: Storybook serves it at
 * `/assets`, so authors write `/assets/logo.png`, but Vite only resolves that
 * against the project root.
 *
 * ## The rule
 *
 * This runs after Vite's own CSS URL resolution, so every `url()` it sees is
 * one Vite already declined to resolve. That makes the repair non-destructive
 * by construction: it can never displace a reference that works today. When
 * the `assets/...` tail of an unresolvable URL names exactly one real file
 * under a real asset root, the URL is rewritten to the canonical form and the
 * asset is queued for emit. Anything else is left exactly as it was.
 */

import { dirname, posix, resolve } from 'path';

import { resolveAssetTail } from '../../utils/asset-roots.js';
import { safeExists } from '../../utils/fs-safe.js';
import { toPosixPath } from '../../utils/paths.js';

/**
 * Published prefix every asset root is served under.
 *
 * @type {string}
 */
export const PUBLIC_ASSET_PREFIX = 'assets';

/**
 * Match a CSS `url()` call, preferring the quoted form.
 *
 * Mirrors Vite's own `cssUrlRE` so the two agree on what a URL token is. The
 * lookbehind keeps `image-set(...)` and custom `--foo-url(` idents from
 * matching mid-identifier.
 *
 * @type {RegExp}
 */
const CSS_URL_RE =
  /(?<=^|[^\w\-\u0080-\uffff])url\((\s*('[^']*'|"[^"]*")\s*|[^'")]+)\)/g;

/** Leading `./` and `../` segments — "the tail" is what remains after these. */
const LEADING_RELATIVE_RE = /^(?:\.{1,2}\/)+/;

/** Values that can never name a file on disk. */
const NON_FILESYSTEM_RE = /^(?:#|\/\/|[a-z][a-z0-9+.-]*:|var\(|env\()/i;

/**
 * Split a URL into its filesystem path and any `?query` / `#hash` suffix.
 *
 * @param {string} value - Raw URL value without quotes.
 * @returns {{path: string, suffix: string}} Split URL.
 */
export function splitUrlSuffix(value) {
  const index = value.search(/[?#]/);

  return index === -1
    ? { path: value, suffix: '' }
    : { path: value.slice(0, index), suffix: value.slice(index) };
}

/**
 * Reduce a URL to the asset path it is reaching for.
 *
 * `../../assets/images/x.jpg` and `assets/images/x.jpg` both reduce to
 * `images/x.jpg`. Requiring the remainder to start with the published prefix
 * is what keeps the repair explainable: a bare `images/x.jpg` is never tried
 * against the asset roots, because nothing about it says "project asset".
 *
 * @param {string} urlPath - URL path without quotes, query, or hash.
 * @returns {string} Asset path relative to an asset root, or an empty string.
 */
export function assetTailFor(urlPath) {
  const normalized = posix.normalize(toPosixPath(urlPath));
  const tail = normalized
    .replace(/^\/+/, '')
    .replace(LEADING_RELATIVE_RE, '')
    .replace(/^\/+/, '');

  if (!tail.startsWith(`${PUBLIC_ASSET_PREFIX}/`)) return '';

  const rest = tail.slice(PUBLIC_ASSET_PREFIX.length + 1);

  return !rest || rest.startsWith('..') ? '' : rest;
}

/**
 * Decide what a single unresolved CSS `url()` should become.
 *
 * @param {string} value - URL value as written, without quotes.
 * @param {string} importer - Absolute path of the stylesheet being compiled.
 * @param {string[]} roots - Absolute asset roots, in precedence order.
 * @returns {{status: 'skipped'|'missing'|'ambiguous'|'rebased'|'publish', url?: string, file?: string, emitAs?: string, candidates?: string[]}} Plan.
 */
export function planAssetUrl(value, importer, roots = []) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return { status: 'skipped' };

  // Sass interpolation that survives compilation only appears in unquoted
  // url(), which Sass passes through verbatim. Never guess at it.
  if (trimmed.includes('#{') || trimmed.includes('$')) {
    return { status: 'skipped' };
  }

  if (NON_FILESYSTEM_RE.test(trimmed)) return { status: 'skipped' };

  const { path: urlPath, suffix } = splitUrlSuffix(trimmed);
  if (!urlPath) return { status: 'skipped' };

  const isRootAbsolute = urlPath.startsWith('/');
  const isRelative = LEADING_RELATIVE_RE.test(urlPath);
  const isBareAssets = urlPath.startsWith(`${PUBLIC_ASSET_PREFIX}/`);

  // A bare specifier that is not `assets/...` belongs to Vite: it may resolve
  // through package exports or an alias, and stealing it would be a
  // regression.
  if (!isRootAbsolute && !isRelative && !isBareAssets) {
    return { status: 'skipped' };
  }

  // Defence in depth. Under this hook Vite has already proven the URL does not
  // resolve from the stylesheet, but the check keeps the function honest when
  // called in isolation.
  if (
    isRelative &&
    importer &&
    safeExists(resolve(dirname(importer), urlPath))
  ) {
    return { status: 'skipped' };
  }

  const rest = assetTailFor(urlPath);
  if (!rest) return { status: 'skipped' };

  const hit = resolveAssetTail(rest, roots);
  if (hit.status !== 'resolved') {
    return {
      status: hit.status,
      originalUrl: trimmed,
      candidates: hit.candidates,
    };
  }

  const canonical = `/${PUBLIC_ASSET_PREFIX}/${rest}`;
  const emitAs = `${PUBLIC_ASSET_PREFIX}/${rest}`;

  // A URL already in canonical form only needs its asset published; rewriting
  // it would be a no-op edit that churns the emitted CSS.
  if (urlPath === canonical) {
    return { status: 'publish', originalUrl: trimmed, file: hit.file, emitAs };
  }

  return {
    status: 'rebased',
    originalUrl: trimmed,
    url: `${canonical}${suffix}`,
    file: hit.file,
    emitAs,
  };
}

/**
 * Rewrite every repairable asset URL in one stylesheet.
 *
 * @param {string} code - Compiled CSS.
 * @param {string} importer - Absolute path of the stylesheet.
 * @param {string[]} roots - Absolute asset roots, in precedence order.
 * @param {(plan: object, context: {value: string}) => void} [onPlan] - Plan observer.
 * @returns {{code: string, changed: boolean}} Rewritten CSS.
 */
export function rewriteStylesheetUrls(code, importer, roots = [], onPlan) {
  let changed = false;

  const next = code.replace(CSS_URL_RE, (match, inner, quoted) => {
    const quote = quoted ? quoted[0] : '';
    const value = quoted ? quoted.slice(1, -1) : String(inner).trim();

    const plan = planAssetUrl(value, importer, roots);
    if (typeof onPlan === 'function') onPlan(plan, { value });

    if (plan.status !== 'rebased') return match;

    changed = true;

    return `url(${quote}${plan.url}${quote})`;
  });

  return { code: changed ? next : code, changed };
}
