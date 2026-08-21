/**
 * @file Static source asset copy plugin.
 *
 * Copies non-code source assets beside the JS/CSS/Twig output that references
 * them, preserving component and global routing semantics.
 */

import { copyFileSync, lstatSync, mkdirSync, unlinkSync } from 'fs';
import { dirname, isAbsolute, join, resolve } from 'path';

import {
  copiedComponentOutputPath,
  copiedGlobalOutputPath,
  findSourceRoot,
} from '../../project-structure.js';
import {
  fileContentFingerprint,
  filesHaveSameBytes,
  resolveFinalPath,
} from './output-freshness.js';
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
  let completedWatchCycles = 0;
  /** @type {Array<{absPath: string, relDest: string}>|undefined} */
  let plan;
  /**
   * @type {Map<string, {sourcePaths: Set<string>, fingerprint: string}>}
   * Owned destination -> sources and the bytes this plugin established.
   */
  let previousOutputs = new Map();

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
        ? removeStaleOutputs(currentPlan, (message) => this.warn?.(message))
        : new Map();
      const unverifiedWrites = new Set();

      for (const { absPath, relDest } of currentPlan) {
        const copyResult = copyToOutDir(absPath, relDest);
        if (!watching || !relDest) continue;

        if (copyResult.status === 'written') {
          // A successful write replaces any prior bytes. Only retain deletion
          // authority when those new bytes were fingerprinted successfully.
          currentOutputs.delete(relDest);
          if (copyResult.fingerprint) {
            unverifiedWrites.delete(relDest);
            recordOwnedOutput(
              currentOutputs,
              relDest,
              [absPath],
              copyResult.fingerprint,
            );
          } else {
            unverifiedWrites.add(relDest);
          }
        } else if (unverifiedWrites.has(relDest)) {
          continue;
        } else if (currentOutputs.has(relDest)) {
          const currentOwnership = currentOutputs.get(relDest);
          recordOwnedOutput(
            currentOutputs,
            relDest,
            [absPath],
            currentOwnership.fingerprint,
          );
        } else if (previousOutputs.has(relDest)) {
          const previousOwnership = previousOutputs.get(relDest);
          recordOwnedOutput(
            currentOutputs,
            relDest,
            [...previousOwnership.sourcePaths, absPath],
            previousOwnership.fingerprint,
          );
        }
      }

      if (watching) {
        previousOutputs = currentOutputs;
        completedWatchCycles += 1;
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
   * Remove outputs owned in the previous cycle whose sources disappeared.
   *
   * @param {Array<{relDest: string}>} currentPlan - Current cycle copy plan.
   * @param {(message: string) => void} warn - Build warning reporter.
   * @returns {Map<string, {sourcePaths: Set<string>, fingerprint: string}>} Outputs still owned after pruning.
   */
  function removeStaleOutputs(currentPlan, warn) {
    const plannedOutputs = new Set(
      currentPlan.map(({ relDest }) => relDest).filter(Boolean),
    );
    const retainedOutputs = new Map();

    for (const [relDest, ownership] of previousOutputs) {
      if (plannedOutputs.has(relDest)) continue;
      if (![...ownership.sourcePaths].every(sourceNoLongerExists)) {
        recordOwnedOutput(
          retainedOutputs,
          relDest,
          ownership.sourcePaths,
          ownership.fingerprint,
        );
        continue;
      }

      const stalePath = resolveFinalPath(relDest, {
        outDir: absoluteOutDir(),
        projectDir,
        mirrored: structure?.mirrorComponentOutput,
      });
      const currentFingerprint = fileContentFingerprint(stalePath);
      if (currentFingerprint === null) {
        if (!sourceNoLongerExists(stalePath)) {
          recordOwnedOutput(
            retainedOutputs,
            relDest,
            ownership.sourcePaths,
            ownership.fingerprint,
          );
          warn?.(
            `Unable to verify stale copied output ${stalePath}; leaving it in place and retrying on the next rebuild.`,
          );
        }
        continue;
      }

      if (currentFingerprint !== ownership.fingerprint) {
        // Another writer replaced the output, so this plugin no longer has
        // authority to remove that destination.
        continue;
      }

      try {
        unlinkSync(stalePath);
      } catch (error) {
        // An already-absent output needs no retry. Keep ownership after any
        // other failure so a later cycle can try pruning it again.
        if (error?.code !== 'ENOENT') {
          recordOwnedOutput(
            retainedOutputs,
            relDest,
            ownership.sourcePaths,
            ownership.fingerprint,
          );
          warn?.(
            `Unable to remove stale copied output ${stalePath}: ${error?.message || error}`,
          );
        }
      }
    }

    return retainedOutputs;
  }

  /**
   * Record the source paths for an output this plugin owns.
   *
   * @param {Map<string, {sourcePaths: Set<string>, fingerprint: string}>} outputs - Ownership map to update.
   * @param {string} relDest - Destination relative to `outDir`.
   * @param {Iterable<string>} sourcePaths - Source paths backing the output.
   * @param {string} fingerprint - Bytes this plugin established.
   * @returns {void}
   */
  function recordOwnedOutput(outputs, relDest, sourcePaths, fingerprint) {
    const sources = outputs.get(relDest)?.sourcePaths || new Set();
    for (const sourcePath of sourcePaths) sources.add(sourcePath);
    outputs.set(relDest, { sourcePaths: sources, fingerprint });
  }

  /**
   * Determine whether a former source is definitively gone.
   *
   * Errors such as EACCES are not evidence of deletion. Keeping the output and
   * its ownership lets a later cycle retry after a transient filesystem issue.
   *
   * @param {string} sourcePath - Absolute source path.
   * @returns {boolean} TRUE only for a missing path or missing parent segment.
   */
  function sourceNoLongerExists(sourcePath) {
    try {
      lstatSync(sourcePath);
      return false;
    } catch (error) {
      return error?.code === 'ENOENT' || error?.code === 'ENOTDIR';
    }
  }

  /**
   * Copy one file into the output directory.
   *
   * @param {string} absPath - Absolute source path.
   * @param {string} relDest - Destination relative to `outDir`.
   * @returns {{status: 'written'|'skipped'|'failed', fingerprint: string|null}} Copy result and fingerprint of newly written bytes.
   */
  function copyToOutDir(absPath, relDest) {
    if (!relDest) return { status: 'failed', fingerprint: null };

    // Skip assets whose bytes already match. Mirrored output is the one startup
    // exception; see copy-twig-files.js for why its first copy is unconditional.
    if (
      watching &&
      (completedWatchCycles > 0 || !structure?.mirrorComponentOutput) &&
      filesHaveSameBytes(
        absPath,
        resolveFinalPath(relDest, {
          outDir: absoluteOutDir(),
          projectDir,
          mirrored: structure?.mirrorComponentOutput,
        }),
      )
    ) {
      return { status: 'skipped', fingerprint: null };
    }

    const destPath = join(outDir, relDest);
    mkdirSync(dirname(destPath), { recursive: true });
    try {
      copyFileSync(absPath, destPath);
      return {
        status: 'written',
        fingerprint: watching ? fileContentFingerprint(destPath) : null,
      };
    } catch {
      return { status: 'failed', fingerprint: null };
    }
  }
}
