/**
 * @file Twig template and component metadata copy plugin.
 *
 * Copies canonical source Twig files and component metadata to the emitted dist
 * structure using the same routing rules as compiled JS and CSS entries.
 */

import { copyFileSync, mkdirSync, unlinkSync } from 'fs';
import { dirname, isAbsolute, join, resolve } from 'path';

import {
  copiedComponentOutputPath,
  copiedGlobalOutputPath,
} from '../../project-structure.js';
import { filesHaveSameBytes, resolveFinalPath } from './output-freshness.js';
import {
  createSourceFileIndex,
  isComponentMetadataFile,
} from './source-file-index.js';

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
  let projectDir = process.cwd();
  let watching = false;
  /** @type {Array<{absPath: string, relDest: string}>|undefined} */
  let plan;
  let previousOutputs = new Set();

  /**
   * Resolve every file this plugin copies, paired with where it lands.
   *
   * Shared by both hooks, which keeps "gets copied to dist" and "a save
   * triggers the copy" from drifting apart. A structural watch event resets
   * the plan so a rename can replace the old output without restarting the
   * watcher; content-only edits keep the cached filesystem walk.
   *
   * @returns {Array<{absPath: string, relDest: string}>} Copy plan.
   */
  const copyPlan = () => {
    if (plan) return plan;

    plan = [];

    // A leading underscore excludes a stylesheet from compilation, because a Sass
    // partial is inlined into whatever imports it and has no output of its own.
    // Twig has no equivalent: `{% include %}` and `{% embed %}` resolve at render
    // time against the emitted tree, so an underscored template is a file the site
    // still has to find. Skipping those left the include unresolvable at runtime.
    for (const file of sourceFileIndex.componentFiles()) {
      if (
        !file.absPath.endsWith('.twig') &&
        !isComponentMetadataFile(file.absPath)
      ) {
        continue;
      }

      plan.push({
        absPath: file.absPath,
        relDest: copiedComponentOutputPath(file.absPath, structure),
      });
    }

    for (const file of sourceFileIndex.globalFiles()) {
      if (!file.absPath.endsWith('.twig')) continue;

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
      projectDir = cfg.root || process.cwd();
      watching = Boolean(cfg.build?.watch);
    },

    watchChange(_id, { event } = {}) {
      if (!watching || (event !== 'create' && event !== 'delete')) return;
      sourceFileIndex.refresh?.();
      plan = undefined;
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

    // A rewritten template in the output tree is a full preview reload rather
    // than a style swap, so during watch the copy is skipped when the bytes
    // already match. `stableWatchOutputPlugin` stops Vite emptying the output
    // directory after the first cycle, which is what leaves anything there to
    // compare against; one-shot builds start from an empty tree and copy
    // unconditionally as before.
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
