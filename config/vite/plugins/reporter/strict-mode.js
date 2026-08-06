/**
 * @file Strict asset URL resolution for CI.
 *
 * An unresolvable CSS `url()` is a broken image at runtime, but it has never
 * failed a build — Vite prints one line and exits 0, so the breakage ships. A
 * project that wants that treated as an error opts in here.
 *
 * ## Why an environment variable and not a CLI flag
 *
 * `vite build --strict-assets` cannot work: cac rejects unknown options unless
 * the command opts into `allowUnknownOptions()`, and Storybook's commander is
 * the same. `verbosity.js` already documents the npm bridge that gets around
 * that — `npm run build --strict-assets` exports `npm_config_strict_assets`
 * into the script environment — so both triggers are honored here for the same
 * reason.
 */

/**
 * Strictness levels for CSS asset URL resolution.
 *
 * @type {{off: string, unresolved: string, all: string}}
 */
export const STRICTNESS = {
  off: 'off',
  unresolved: 'unresolved',
  all: 'all',
};

/** Values that read as "off" regardless of which trigger set them. */
const OFF_VALUES = ['', '0', 'false', 'off', 'no'];

/**
 * Resolve how strictly the build should treat CSS asset URL problems.
 *
 * `1` fails on URLs nothing could resolve. `2` also fails on URLs the build had
 * to repair, for projects that want the canonical form written in source rather
 * than fixed up at build time.
 *
 * @param {{EMULSIFY_STRICT_ASSETS?: string, npm_config_strict_assets?: string}} [env] - Environment variables.
 * @returns {string} One of {@link STRICTNESS}.
 */
export function resolveAssetStrictness(env = process.env) {
  const requested = String(
    env?.EMULSIFY_STRICT_ASSETS ?? env?.npm_config_strict_assets ?? '',
  )
    .toLowerCase()
    .trim();

  if (OFF_VALUES.includes(requested)) return STRICTNESS.off;
  if (requested === '2' || requested === 'all') return STRICTNESS.all;

  return STRICTNESS.unresolved;
}

/**
 * Count the asset problems that should fail the build at a strictness level.
 *
 * @param {{unresolvedAssets?: object[], assetRebases?: object[]}} snapshot - Diagnostics snapshot.
 * @param {string} strictness - One of {@link STRICTNESS}.
 * @returns {number} Failing problem count.
 */
export function countStrictAssetFailures(snapshot = {}, strictness) {
  if (strictness === STRICTNESS.off) return 0;

  const unresolved = snapshot.unresolvedAssets?.length || 0;
  if (strictness !== STRICTNESS.all) return unresolved;

  return unresolved + (snapshot.assetRebases?.length || 0);
}
