/**
 * @file Static source asset copy plugin.
 *
 * Copies non-code source assets beside the JS/CSS/Twig output that references
 * them, preserving component and global routing semantics.
 */

import { copyFileSync, mkdirSync, unlinkSync } from 'fs';
import { dirname, isAbsolute, join, resolve } from 'path';

import {
  copiedComponentOutputPath,
  copiedGlobalOutputPath,
  findSourceRoot,
} from '../../project-structure.js';
import { filesHaveSameBytes, resolveFinalPath } from './output-freshness.js';
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
  let projectDir = process.cwd();
  let watching = false;
  /** @type {Array<{absPath: string, relDest: string}>|undefined} */
  let plan;
  let previousOutputs = new Set();

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
      projectDir = cfg.root || process.cwd();
      watching = Boolean(cfg.build?.watch);
    },

    watchChange(_id, { event } = {}) {
      if (!watching || (event !== 'create' && event !== 'delete')) return;
      sourceFileIndex.refresh?.();
      plan = undefined;
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
      const currentPlan = copyPlan();
      const currentOutputs = watching
        ? removeStaleOutputs(currentPlan)
        : previousOutputs;

      for (const { absPath, relDest } of currentPlan) {
        copyToOutDir(absPath, relDest);
      }

      if (watching) previousOutputs = currentOutputs;
    },
  };

  /**
   * Resolve the output directory to an absolute path.
   *
   * @returns {string} Absolute output directory.
   */
  function absoluteOutDir() {
    return isAbsolute(outDir) ? outDir : resolve(projectDir, outDir);
  }

  /**
   * Remove outputs owned in the previous cycle whose sources disappeared.
   *
   * @param {Array<{relDest: string}>} currentPlan - Current cycle copy plan.
   * @returns {Set<string>} Current output paths for the next comparison.
   */
  function removeStaleOutputs(currentPlan) {
    const currentOutputs = new Set(
      currentPlan.map(({ relDest }) => relDest).filter(Boolean),
    );

    for (const relDest of previousOutputs) {
      if (currentOutputs.has(relDest)) continue;

      const stalePath = resolveFinalPath(relDest, {
        outDir: absoluteOutDir(),
        projectDir,
        mirrored: structure?.mirrorComponentOutput,
      });
      try {
        unlinkSync(stalePath);
      } catch {
        /* noop */
      }
    }

    return currentOutputs;
  }

  /**
   * Copy one file into the output directory.
   *
   * @param {string} absPath - Absolute source path.
   * @param {string} relDest - Destination relative to `outDir`.
   * @returns {void}
   */
  function copyToOutDir(absPath, relDest) {
    if (!relDest) return;

    // Skipped during watch when the bytes already match; see the note in
    // copy-twig-files.js for why the destination is now worth checking.
    if (
      watching &&
      filesHaveSameBytes(
        absPath,
        resolveFinalPath(relDest, {
          outDir: absoluteOutDir(),
          projectDir,
          mirrored: structure?.mirrorComponentOutput,
        }),
      )
    ) {
      return;
    }

    const destPath = join(outDir, relDest);
    mkdirSync(dirname(destPath), { recursive: true });
    try {
      copyFileSync(absPath, destPath);
    } catch {
      /* noop */
    }
  }
}
