/**
 * @file Keep `vite build --watch` output stable between rebuilds.
 *
 * ## The problem
 *
 * Saving one component during `npm run develop` used to rewrite every file in
 * the output tree. Measured on a real theme, one edit produced:
 *
 *     [vite] hot updated: /dist/global/layout/layout.css
 *     [vite] hot updated: /dist/storybook/components/atoms/textures/cl-textures.css
 *
 * Neither file was touched by the edit, and the edited component's own
 * stylesheet is not in the list. Storybook then reloaded the preview iframe
 * instead of swapping the stylesheet in place.
 *
 * ## Why every file changed
 *
 * Two independent causes, and both have to be removed or the churn remains.
 *
 * 1. Vite empties the output directory on **every** watch rebuild, not just the
 *    first. The emptying runs from a `renderStart` hook guarded by a
 *    "already prepared this environment" set, and Vite's `watchChange` hook
 *    clears that set, so the guard is re-armed before each cycle. Every
 *    stylesheet is therefore deleted and recreated per keystroke. Deleting a
 *    file that Storybook reached through an eager `import.meta.glob` changes
 *    the glob's module set, which is a full-reload invalidation rather than a
 *    CSS swap — the flash.
 *
 * 2. Rollup regenerates and rewrites the whole bundle each cycle regardless.
 *    Even with the directory left alone, every stylesheet would get a fresh
 *    mtime and every watcher would fire.
 *
 * ## What this plugin does
 *
 * Turns off the per-rebuild emptying once the first cycle has had its clean
 * tree, then drops bytes-identical stylesheets from the bundle so Rollup never
 * rewrites them. The first cycle still empties, through Vite's own code and its
 * own guards, so a develop session starts exactly as it does today.
 *
 * A dropped asset leaves the existing file untouched, so no watcher event
 * fires and no HMR update is sent for a stylesheet the edit could not have
 * affected. This mirrors what `mirror-components.js` already does for mirrored
 * component output, where `filesHaveSameBytes` skips the move; plain output had
 * no equivalent.
 *
 * Scoped to emitted assets, not JavaScript chunks: a chunk travels with a
 * sourcemap and a hashed name graph, and skipping one of a pair is a harder
 * claim to make. CSS is where the cost lands anyway, because stylesheets are
 * what the preview enumerates by glob.
 *
 * Stylesheets are not the only churn source. Twig templates and static assets
 * are copied straight to disk rather than emitted through the bundle, so they
 * carry the same freshness check in their own plugins; a rewritten `.twig` in
 * the output tree is a full preview reload rather than a style swap.
 *
 * One-shot builds are untouched: `npm run build`, `storybook build`, and the
 * release fixture verifications all start from an emptied directory and write
 * every file unconditionally.
 */

import { isAbsolute, resolve } from 'path';

import { bytesAlreadyOnDisk, resolveFinalPath } from './output-freshness.js';

/**
 * Keep watch-build output stable so unchanged stylesheets are not rewritten.
 *
 * @param {{
 *   projectDir?: string,
 *   mirrorComponentOutput?: boolean,
 *   unchangedOutputs?: Set<string>
 * }} [opts={}] - Plugin options. `unchangedOutputs` is shared with the develop
 *   reporter so a skipped file is not reported as a deleted one.
 * @returns {import('vite').PluginOption} Stable watch output plugin.
 */
export function stableWatchOutputPlugin({
  projectDir = process.cwd(),
  mirrorComponentOutput = false,
  unchangedOutputs = new Set(),
} = {}) {
  let outDir = 'dist';
  let watching = false;

  return {
    name: 'emulsify-stable-watch-output',
    apply: 'build',

    // Runs after the plugins that rewrite CSS text, or an asset would be
    // compared before its URLs were finalized and always look changed.
    enforce: 'post',

    configResolved(config) {
      const configured = config?.build?.outDir || 'dist';
      outDir = isAbsolute(configured)
        ? configured
        : resolve(projectDir, configured);
      watching = Boolean(config?.build?.watch);
    },

    buildStart() {
      unchangedOutputs.clear();
    },

    // Vite empties the output directory from its own `renderStart`, declared
    // `order: 'pre'`. By the time this runs the first cycle has already had its
    // clean tree, so switching the flag off here keeps that behavior exactly as
    // it is and stops every later cycle from deleting the tree again. Leaving
    // the decision to Vite for that first cycle also inherits its refusal to
    // empty an output directory that sits outside the project root.
    //
    // The flag has to be set on `this.environment.config`: the config object
    // `configResolved` receives is a different one, and mutating that has no
    // effect on what Vite reads per cycle.
    renderStart() {
      if (!watching) return;

      const buildOptions = this.environment?.config?.build;
      if (buildOptions) buildOptions.emptyOutDir = false;
    },

    generateBundle(_options, bundle) {
      // A one-shot build always starts from an emptied directory, so nothing
      // would match; leaving it alone keeps release output byte for byte.
      if (!watching) return;

      for (const [fileName, output] of Object.entries(bundle)) {
        // Assets only. A JavaScript chunk travels with a sourcemap and a hashed
        // name graph, and skipping one of a pair is a harder claim to make;
        // nothing in the preview enumerates chunks by glob, so there is no
        // reload to win back.
        if (output.type !== 'asset') continue;
        if (output.source == null) continue;

        const finalPath = resolveFinalPath(fileName, {
          outDir,
          projectDir,
          mirrored: mirrorComponentOutput,
        });

        if (bytesAlreadyOnDisk(finalPath, output.source)) {
          unchangedOutputs.add(fileName);
          delete bundle[fileName];
        }
      }
    },
  };
}
