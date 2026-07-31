/**
 * @file Static source asset copy plugin.
 *
 * Copies non-code source assets beside the JS/CSS/Twig output that references
 * them, preserving component and global routing semantics.
 */

import { copyFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';

import {
  copiedComponentOutputPath,
  copiedGlobalOutputPath,
  findSourceRoot,
} from '../../project-structure.js';
import {
  createSourceFileIndex,
  isStaticSourceAsset,
} from './source-file-index.js';

/**
 * Copy non-code assets from source roots to `dist/`.
 *
 * @param {{ structure: object, sourceFileIndex?: object }} opts - Plugin options.
 * @returns {import('vite').PluginOption} Copy plugin.
 */
export function copyAllSrcAssetsPlugin({
  structure,
  sourceFileIndex = createSourceFileIndex(structure),
}) {
  let outDir = 'dist';
  let watching = false;
  /** @type {Array<{absPath: string, relDest: string}>|undefined} */
  let plan;

  /**
   * Resolve every asset this plugin copies, paired with where it lands.
   *
   * Shared by both hooks for the same reason as the Twig copier: watching and
   * copying have to be driven by one list, or a file can end up copied on a full
   * build and ignored on a save.
   *
   * @returns {Array<{absPath: string, relDest: string}>} Copy plan.
   */
  const copyPlan = () => {
    if (plan) return plan;

    plan = [];

    for (const file of sourceFileIndex.componentFiles()) {
      if (!isStaticSourceAsset(file.absPath)) continue;

      plan.push({
        absPath: file.absPath,
        relDest: copiedComponentOutputPath(file.absPath, structure),
      });
    }

    for (const file of sourceFileIndex.globalFiles()) {
      if (!isStaticSourceAsset(file.absPath)) continue;
      if (findSourceRoot(file.absPath, structure.componentRootRecords))
        continue;

      plan.push({
        absPath: file.absPath,
        relDest: copiedGlobalOutputPath(file.absPath, structure),
      });
    }

    return plan;
  };

  return {
    name: 'emulsify-copy-all-src-assets',
    apply: 'build',
    enforce: 'post',

    /** Capture outDir. */
    configResolved(cfg) {
      outDir = cfg.build?.outDir || 'dist';
      watching = Boolean(cfg.build?.watch);
    },

    // Static assets are copied rather than compiled, so like Twig they are absent
    // from Rollup's module graph and a save would otherwise go unnoticed. Swapping
    // an SVG or a font left the old bytes in `dist/` until an unrelated rebuild.
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
    const destPath = join(outDir, relDest);
    mkdirSync(dirname(destPath), { recursive: true });
    try {
      copyFileSync(absPath, destPath);
    } catch {
      /* noop */
    }
  }
}
