/**
 * @file Twig template and component metadata copy plugin.
 *
 * Copies canonical source Twig files and component metadata to the emitted dist
 * structure using the same routing rules as compiled JS and CSS entries.
 */

import { copyFileSync, lstatSync, mkdirSync, unlinkSync } from 'fs';
import { dirname, isAbsolute, join, resolve } from 'path';

import {
  copiedComponentOutputPath,
  copiedGlobalOutputPath,
} from '../../project-structure.js';
import {
  fileContentFingerprint,
  filesHaveSameBytes,
  resolveFinalPath,
} from './output-freshness.js';
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
  let completedWatchCycles = 0;
  /** @type {Array<{absPath: string, relDest: string}>|undefined} */
  let plan;
  /**
   * @type {Map<string, {sourcePaths: Set<string>, fingerprint: string}>}
   * Owned destination -> sources and the bytes this plugin established.
   */
  let previousOutputs = new Map();

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

    // A mirrored first watch cycle copies unconditionally so this plugin
    // establishes ownership when a generated project-root destination survived
    // a prior process. Otherwise byte-identical templates are skipped: rewriting
    // one is a full preview reload rather than a style swap. One-shot builds
    // continue to copy unconditionally as before.
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
