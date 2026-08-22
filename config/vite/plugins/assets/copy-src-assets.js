/**
 * @file Static source asset copy plugin.
 *
 * Copies non-code source assets beside the JS/CSS/Twig output that references
 * them, preserving component and global routing semantics.
 */

import { copyFileSync, mkdirSync, statSync } from 'fs';
import { dirname, isAbsolute, join, resolve } from 'path';

import {
  copiedComponentOutputPath,
  copiedGlobalOutputPath,
  findSourceRoot,
} from '../../project-structure.js';
import {
  filesHaveSameBytes,
  removeDestinationSymlink,
  resolveFinalPath,
} from './output-freshness.js';
import {
  createSourceFileIndex,
  isStaticSourceAsset,
} from './source-file-index.js';

/**
 * Copy non-code assets from source roots to `dist/`.
 *
 * @param {{ structure: object, sourceFileIndex?: object, diagnostics?: object, outputChanges?: Map<string, {kind: 'written'|'removed', bytes?: number}> }} opts - Plugin options.
 * @returns {import('vite').PluginOption} Copy plugin.
 */
export function copyAllSrcAssetsPlugin({
  structure,
  sourceFileIndex = createSourceFileIndex(structure),
  diagnostics,
  outputChanges,
}) {
  let outDir = 'dist';
  let projectDir = process.cwd();
  let watching = false;
  /** @type {Array<{absPath: string, relDest: string}>|undefined} */
  let plan;

  /**
   * Resolve every asset this plugin copies, paired with where it lands.
   *
   * Shared by both hooks for the same reason as the Twig copier: watching and
   * copying have to be driven by one list, or a file can end up copied on a full
   * build and ignored on a save. File create and delete events refresh the plan
   * so newly created sources are copied. Previous destinations are not pruned.
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
      for (const { absPath, relDest } of copyPlan()) {
        const copyResult = copyToOutDir(absPath, relDest);
        if (watching && copyResult.status === 'written') {
          outputChanges?.set(relDest, {
            kind: 'written',
            bytes: copyResult.bytes,
          });
        }
        if (copyResult.status === 'failed' && copyResult.error) {
          const errno = copyResult.error.code ?? 'unknown error';
          const message = `Unable to copy ${absPath} to ${join(outDir, relDest)} (${errno}): ${copyResult.error.message}`;
          diagnostics?.recordError?.({
            message,
            file: absPath,
            outputState: 'incomplete',
          });
          this.warn?.(message);
        }
      }
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
   * Copy one file into the output directory.
   *
   * @param {string} absPath - Absolute source path.
   * @param {string} relDest - Destination relative to `outDir`.
   * @returns {{status: 'written'|'skipped'|'failed', bytes?: number, error?: Error}} Copy result.
   */
  function copyToOutDir(absPath, relDest) {
    if (!relDest) return { status: 'failed' };

    // Skip assets whose bytes already match during watch. One-shot builds
    // continue to copy unconditionally as before.
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
      return { status: 'skipped' };
    }

    const destPath = join(outDir, relDest);
    mkdirSync(dirname(destPath), { recursive: true });
    try {
      removeDestinationSymlink(destPath);
      copyFileSync(absPath, destPath);
      let bytes;
      if (watching && outputChanges) {
        try {
          bytes = statSync(destPath).size;
        } catch {
          // The write still succeeded; size is optional reporting metadata.
        }
      }
      return { status: 'written', bytes };
    } catch (error) {
      return {
        status: 'failed',
        error,
      };
    }
  }
}
