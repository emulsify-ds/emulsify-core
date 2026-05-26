/**
 * @file Drupal component mirror plugin.
 *
 * Mirrors built `dist/components/**` files back to project-root `components/**`
 * for Drupal SDC projects that author canonical components under `src/`.
 */

import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmdirSync,
  statSync,
  unlinkSync,
} from 'fs';
import { dirname, join, resolve } from 'path';

import { safeExists } from '../utils/fs-safe.js';
import { walkFiles } from './source-file-index.js';

/**
 * Remove empty parent directories from a start directory up to, but not including,
 * a stopping boundary directory.
 *
 * @param {string} startDir - Directory to prune from.
 * @param {string} stopAtDir - Boundary directory.
 */
const pruneEmptyDirsUpTo = (startDir, stopAtDir) => {
  const stopAbs = resolve(stopAtDir);
  let cursor = resolve(startDir);

  const isEmpty = (dir) => {
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      return readdirSync(dir).length === 0;
    } catch {
      return false;
    }
  };

  while (cursor.startsWith(stopAbs)) {
    if (!isEmpty(cursor)) break;

    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      rmdirSync(cursor);
    } catch {
      // Stop at the first directory that cannot be removed.
      break;
    }

    const parent = dirname(cursor);
    if (parent === cursor || parent === stopAbs) break;
    cursor = parent;
  }
};

/**
 * Determine whether two files already contain the same bytes.
 *
 * @param {string} sourceFile - Source file path.
 * @param {string} destinationFile - Destination file path.
 * @returns {boolean} TRUE when both files have identical bytes.
 */
const filesHaveSameBytes = (sourceFile, destinationFile) => {
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const sourceStats = statSync(sourceFile);
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const destinationStats = statSync(destinationFile);
    if (!destinationStats.isFile()) return false;
    if (sourceStats.size !== destinationStats.size) return false;
    if (sourceStats.size === 0) return true;

    return readFileSync(sourceFile).equals(readFileSync(destinationFile));
  } catch {
    return false;
  }
};

/**
 * Mirror built component files to the project root `./components/` directory.
 *
 * @param {{ enabled: boolean, projectDir: string }} opts - Plugin options.
 * @returns {import('vite').PluginOption} Drupal mirror plugin.
 */
export function mirrorComponentsToRoot({ enabled, projectDir }) {
  let outDir = 'dist';
  return {
    name: 'emulsify-mirror-components-to-root',
    apply: 'build',
    enforce: 'post',
    configResolved(cfg) {
      outDir = cfg.build?.outDir || 'dist';
    },
    closeBundle() {
      if (!enabled) return;
      const distComponents = join(outDir, 'components');
      if (!safeExists(distComponents)) return;

      for (const srcFile of walkFiles(distComponents)) {
        const relFromOutDir = srcFile.slice(join(outDir, '').length);
        const destFile = join(projectDir, relFromOutDir);
        mkdirSync(dirname(destFile), { recursive: true });
        try {
          if (!filesHaveSameBytes(srcFile, destFile)) {
            copyFileSync(srcFile, destFile);
          }
          try {
            // eslint-disable-next-line security/detect-non-literal-fs-filename
            unlinkSync(srcFile);
            pruneEmptyDirsUpTo(dirname(srcFile), distComponents);
          } catch {
            /* noop */
          }
        } catch (e) {
          console.warn(
            `Mirror copy failed for ${relFromOutDir}: ${e?.message || e}`,
          );
        }
      }
      pruneEmptyDirsUpTo(distComponents, outDir);
    },
  };
}
