/**
 * @file Twig template and component metadata copy plugin.
 *
 * Copies canonical source Twig files and component metadata to the emitted dist
 * structure using the same routing rules as compiled JS and CSS entries.
 */

import { copyFileSync, mkdirSync, statSync } from 'fs';
import { dirname, isAbsolute, join, resolve } from 'path';

import {
  copiedComponentOutputPath,
  copiedGlobalOutputPath,
} from '../../project-structure.js';
import {
  filesHaveSameBytes,
  removeDestinationSymlink,
  resolveFinalPath,
} from './output-freshness.js';
import {
  createSourceFileIndex,
  isComponentMetadataFile,
} from './source-file-index.js';

/**
 * Copy Twig templates and component metadata to `dist/`.
 *
 * @param {{ structure: object, sourceFileIndex?: object, diagnostics?: object, outputChanges?: Map<string, {kind: 'written'|'removed', bytes?: number}> }} opts - Plugin options.
 * @returns {import('vite').PluginOption} Copy plugin.
 */
export function copyTwigFilesPlugin({
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
   * Resolve every file this plugin copies, paired with where it lands.
   *
   * Shared by both hooks, which keeps "gets copied to dist" and "a save
   * triggers the copy" from drifting apart. Structural events for an
   * individually watched file reset the plan, so a single-file rename can be
   * copied on the next cycle. New files and component-directory changes sit
   * outside that watch set and require a watcher restart. Previous destinations
   * are not pruned; content-only edits keep the cached filesystem walk.
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

    const destPath = join(outDir, relDest);
    try {
      // A rewritten template in the output tree is a full preview reload rather
      // than a style swap, so byte-identical templates are skipped during watch.
      // One-shot builds continue to copy unconditionally as before.
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

      mkdirSync(dirname(destPath), { recursive: true });
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
