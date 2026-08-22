/**
 * @file Storybook build output markers shared by Core plugins.
 *
 * Storybook copies `staticDirs` into `.out/assets` while the preview build
 * runs, so Vite-generated chunks are routed to a separate directory to avoid
 * concurrent writers. That directory name doubles as the one deterministic
 * signal a Core plugin has for "this build is Storybook's, not the theme's" —
 * no env sniffing, no plugin-name matching, no guessing at `outDir`, which a
 * consumer can override with `-o`.
 */

/**
 * Directory Storybook's Vite build writes generated chunks to.
 *
 * @type {string}
 */
export const STORYBOOK_VITE_ASSETS_DIR = 'storybook-assets';

/**
 * Determine whether a resolved Vite config belongs to a Storybook build.
 *
 * @param {{build?: {assetsDir?: string}}} config - Resolved Vite config.
 * @returns {boolean} TRUE when Storybook owns this output directory.
 */
export function isStorybookOutput(config) {
  return config?.build?.assetsDir === STORYBOOK_VITE_ASSETS_DIR;
}
