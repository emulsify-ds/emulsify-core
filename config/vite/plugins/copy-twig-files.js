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
} from '../project-structure.js';
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

  const copyToOutDir = (absPath, relDest) => {
    if (!relDest) return;
    const destPath = join(outDir, relDest);
    mkdirSync(dirname(destPath), { recursive: true });
    try {
      copyFileSync(absPath, destPath);
    } catch {
      /* noop */
    }
  };

  return {
    name: 'emulsify-copy-twig-files',
    apply: 'build',
    enforce: 'post',

    /** Capture the final outDir. */
    configResolved(cfg) {
      outDir = cfg.build?.outDir || 'dist';
    },

    /** Perform the copying after the bundle has been written. */
    closeBundle() {
      for (const file of sourceFileIndex.componentFiles()) {
        if (file.absPath.endsWith('.twig')) {
          if (isPartial(file.relPath)) continue;
          copyToOutDir(
            file.absPath,
            copiedComponentOutputPath(file.absPath, structure),
          );
        } else if (isComponentMetadataFile(file.absPath)) {
          copyToOutDir(
            file.absPath,
            copiedComponentOutputPath(file.absPath, structure),
          );
        }
      }

      for (const file of sourceFileIndex.globalFiles()) {
        if (!file.absPath.endsWith('.twig')) continue;
        if (isPartial(file.relPath)) continue;
        copyToOutDir(
          file.absPath,
          copiedGlobalOutputPath(file.absPath, structure),
        );
      }
    },
  };
}
