/**
 * @file Twig template and component metadata copy plugin.
 *
 * Copies canonical source Twig files and component metadata to the emitted dist
 * structure using the same routing rules as compiled JS and CSS entries.
 */

import { copyFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';

import {
  copiedComponentOutputPath,
  copiedGlobalOutputPath,
} from '../../project-structure.js';
import {
  createSourceFileIndex,
  isComponentMetadataFile,
} from './source-file-index.js';

/** Determine whether a Twig file is a partial (filename starts with `_`). */
const isPartial = (filePath) =>
  (filePath.split('/')?.pop() || '').trim().startsWith('_');

/**
 * Copy Twig templates and component metadata to `dist/`.
 *
 * @param {{ structure: object, sourceFileIndex?: object }} opts - Plugin options.
 * @returns {import('vite').PluginOption} Copy plugin.
 */
export function copyTwigFilesPlugin({
  structure,
  sourceFileIndex = createSourceFileIndex(structure),
}) {
  let outDir = 'dist';
  let watching = false;
  /** @type {Array<{absPath: string, relDest: string}>|undefined} */
  let plan;

  /**
   * Resolve every file this plugin copies, paired with where it lands.
   *
   * Built once and reused, because the source index is resolved at config time
   * and does not change across watch cycles. Both hooks below read this same
   * list, which is what keeps "gets copied to dist" and "a save triggers the
   * copy" from drifting apart — a file cannot be added to one without the other.
   *
   * @returns {Array<{absPath: string, relDest: string}>} Copy plan.
   */
  const copyPlan = () => {
    if (plan) return plan;

    plan = [];

    for (const file of sourceFileIndex.componentFiles()) {
      const isTwig = file.absPath.endsWith('.twig');

      if (!isTwig && !isComponentMetadataFile(file.absPath)) continue;
      if (isTwig && isPartial(file.relPath)) continue;

      plan.push({
        absPath: file.absPath,
        relDest: copiedComponentOutputPath(file.absPath, structure),
      });
    }

    for (const file of sourceFileIndex.globalFiles()) {
      if (!file.absPath.endsWith('.twig')) continue;
      if (isPartial(file.relPath)) continue;

      plan.push({
        absPath: file.absPath,
        relDest: copiedGlobalOutputPath(file.absPath, structure),
      });
    }

    return plan;
  };

  return {
    name: 'emulsify-copy-twig-files',
    apply: 'build',
    enforce: 'post',

    /** Capture the final outDir. */
    configResolved(cfg) {
      outDir = cfg.build?.outDir || 'dist';
      watching = Boolean(cfg.build?.watch);
    },

    // Twig is copied rather than compiled, so none of it reaches Rollup's module
    // graph, and Rollup only watches what is in that graph. Without this, saving
    // a template produced no rebuild at all: `dist/` kept the previous version
    // until some unrelated stylesheet happened to change. Storybook renders Twig
    // through its own pipeline and looked correct throughout, so the stale copy
    // was only visible to whatever consumes `dist/` — which on Drupal is the site.
    buildStart() {
      if (!watching) return;
      for (const { absPath } of copyPlan()) this.addWatchFile(absPath);
    },

    /** Copy before the mirror plugin moves dist/components to the project root. */
    writeBundle() {
      for (const { absPath, relDest } of copyPlan()) {
        copyToOutDir(absPath, relDest);
      }
    },
  };

  /**
   * Copy one file into the output directory.
   *
   * @param {string} absPath - Absolute source path.
   * @param {string} relDest - Destination relative to `outDir`.
   * @returns {void}
   */
  function copyToOutDir(absPath, relDest) {
    if (!relDest) return;

    // Copied unconditionally, because `build.emptyOutDir` clears the output
    // directory on every watch cycle and not just the first — a freshness check
    // against the destination can never find anything to skip.
    const destPath = join(outDir, relDest);
    mkdirSync(dirname(destPath), { recursive: true });
    try {
      copyFileSync(absPath, destPath);
    } catch {
      /* noop */
    }
  }
}
