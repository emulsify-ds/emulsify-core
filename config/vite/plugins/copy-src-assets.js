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
} from '../project-structure.js';
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
    name: 'emulsify-copy-all-src-assets',
    apply: 'build',
    enforce: 'post',

    /** Capture outDir. */
    configResolved(cfg) {
      outDir = cfg.build?.outDir || 'dist';
    },

    /** Copy component/global assets. */
    closeBundle() {
      for (const file of sourceFileIndex.componentFiles()) {
        if (!isStaticSourceAsset(file.absPath)) continue;
        copyToOutDir(
          file.absPath,
          copiedComponentOutputPath(file.absPath, structure),
        );
      }

      for (const file of sourceFileIndex.globalFiles()) {
        if (!isStaticSourceAsset(file.absPath)) continue;
        if (findSourceRoot(file.absPath, structure.componentRootRecords)) {
          continue;
        }
        copyToOutDir(
          file.absPath,
          copiedGlobalOutputPath(file.absPath, structure),
        );
      }
    },
  };
}
