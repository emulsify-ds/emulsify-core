/**
 * @file Drupal component mirror plugin.
 *
 * Mirrors built `dist/components/**` files back to project-root `components/**`
 * for Drupal SDC projects that author canonical components under `src/`.
 */

import {
  copyFileSync,
  closeSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  renameSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { basename, dirname, join, resolve } from 'path';

import { safeExists, safeReadJson } from '../utils/fs-safe.js';
import { walkFiles } from './source-file-index.js';

const MIRROR_STATE_FILE = '.emulsify-mirror-state.json';
const FILE_COMPARE_CHUNK_SIZE = 64 * 1024;

/**
 * Resolve the installed Core package version without relying on import.meta so
 * Jest's CommonJS transform can load this Vite plugin module.
 *
 * @param {string} projectDir - Project directory running the build.
 * @returns {string} Emulsify Core package version.
 */
const resolvePackageVersion = (projectDir) => {
  const candidates = [
    join(projectDir, 'node_modules/@emulsify/core/package.json'),
    join(process.cwd(), 'node_modules/@emulsify/core/package.json'),
    join(process.cwd(), 'package.json'),
  ];

  for (const candidate of candidates) {
    const candidatePackage = safeReadJson(candidate).data;
    if (
      candidatePackage?.name === '@emulsify/core' &&
      candidatePackage.version
    ) {
      return candidatePackage.version;
    }
  }

  return '0.0.0';
};

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
      return readdirSync(dir).length === 0;
    } catch {
      return false;
    }
  };

  while (cursor.startsWith(stopAbs)) {
    if (!isEmpty(cursor)) break;

    try {
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
 * Small files are read directly; larger files are compared in fixed-size chunks
 * so the mirror phase does not transiently allocate both complete file bodies.
 *
 * @param {string} sourceFile - Source file path.
 * @param {string} destinationFile - Destination file path.
 * @returns {boolean} TRUE when both files have identical bytes.
 */
export const filesHaveSameBytes = (sourceFile, destinationFile) => {
  try {
    const sourceStats = statSync(sourceFile);
    const destinationStats = statSync(destinationFile);
    if (!destinationStats.isFile()) return false;
    if (sourceStats.size !== destinationStats.size) return false;
    if (sourceStats.size === 0) return true;

    if (sourceStats.size < FILE_COMPARE_CHUNK_SIZE) {
      return readFileSync(sourceFile).equals(readFileSync(destinationFile));
    }

    const sourceBuffer = Buffer.allocUnsafe(FILE_COMPARE_CHUNK_SIZE);
    const destinationBuffer = Buffer.allocUnsafe(FILE_COMPARE_CHUNK_SIZE);
    const sourceHandle = openSync(sourceFile, 'r');
    try {
      const destinationHandle = openSync(destinationFile, 'r');
      try {
        let position = 0;
        while (position < sourceStats.size) {
          const bytesToRead = Math.min(
            FILE_COMPARE_CHUNK_SIZE,
            sourceStats.size - position,
          );
          const sourceBytesRead = readSync(
            sourceHandle,
            sourceBuffer,
            0,
            bytesToRead,
            position,
          );
          const destinationBytesRead = readSync(
            destinationHandle,
            destinationBuffer,
            0,
            bytesToRead,
            position,
          );

          if (sourceBytesRead !== destinationBytesRead) return false;
          if (sourceBytesRead === 0) return false;
          if (
            !sourceBuffer
              .subarray(0, sourceBytesRead)
              .equals(destinationBuffer.subarray(0, destinationBytesRead))
          ) {
            return false;
          }
          position += sourceBytesRead;
        }
        return true;
      } finally {
        closeSync(destinationHandle);
      }
    } finally {
      closeSync(sourceHandle);
    }
  } catch {
    return false;
  }
};

/**
 * Determine whether a filesystem path is a symbolic link.
 *
 * @param {string} filePath - File path to inspect.
 * @returns {boolean} TRUE when the path exists and is a symlink.
 */
const isSymlink = (filePath) => {
  try {
    return lstatSync(filePath).isSymbolicLink();
  } catch {
    return false;
  }
};

/**
 * Remove a source file, ignoring races where it was already removed.
 *
 * @param {string} sourceFile - Source file path.
 */
const removeSourceFile = (sourceFile) => {
  try {
    unlinkSync(sourceFile);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
};

/**
 * Create a temporary path beside the final destination so rename is atomic.
 *
 * @param {string} destinationFile - Destination file path.
 * @returns {string} Adjacent temporary path.
 */
const createTempDestination = (destinationFile) =>
  join(
    dirname(destinationFile),
    `.${basename(destinationFile)}.${process.pid}.${Date.now()}.${Math.random()
      .toString(36)
      .slice(2)}.tmp`,
  );

/**
 * Copy across filesystems or symlink boundaries, then rename into place.
 *
 * @param {string} sourceFile - Source file path.
 * @param {string} destinationFile - Destination file path.
 */
const copyFileIntoPlace = (sourceFile, destinationFile) => {
  const tempDestination = createTempDestination(destinationFile);

  try {
    copyFileSync(sourceFile, tempDestination);
    renameSync(tempDestination, destinationFile);
    removeSourceFile(sourceFile);
  } catch (error) {
    try {
      unlinkSync(tempDestination);
    } catch {
      /* noop */
    }
    throw error;
  }
};

/**
 * Move a mirrored file into place without exposing copy-then-unlink state.
 *
 * @param {string} sourceFile - Built file under dist.
 * @param {string} destinationFile - Mirrored project-root destination.
 */
const moveFileIntoPlace = (sourceFile, destinationFile) => {
  mkdirSync(dirname(destinationFile), { recursive: true });

  if (filesHaveSameBytes(sourceFile, destinationFile)) {
    removeSourceFile(sourceFile);
    return;
  }

  if (isSymlink(sourceFile) || isSymlink(destinationFile)) {
    copyFileIntoPlace(sourceFile, destinationFile);
    return;
  }

  try {
    renameSync(sourceFile, destinationFile);
  } catch (error) {
    if (error?.code !== 'EXDEV') throw error;
    copyFileIntoPlace(sourceFile, destinationFile);
  }
};

/**
 * Safely read the previous mirror state marker.
 *
 * @param {string} markerFile - Marker file path.
 * @returns {object|undefined} Parsed marker state.
 */
const readMirrorState = (markerFile) => {
  const result = safeReadJson(markerFile);
  return result.data;
};

/**
 * Write a mirror state marker.
 *
 * @param {string} markerFile - Marker file path.
 * @param {{ startedAt: string, completedAt: string|null, version: string }} state - Marker state.
 */
const writeMirrorState = (markerFile, state) => {
  mkdirSync(dirname(markerFile), { recursive: true });
  writeFileSync(markerFile, `${JSON.stringify(state, null, 2)}\n`);
};

/**
 * Warn if the previous mirror pass did not complete.
 *
 * @param {string} markerFile - Marker file path.
 */
const warnOnInterruptedMirror = (markerFile) => {
  const previousState = readMirrorState(markerFile);
  if (previousState?.completedAt !== null) return;

  console.warn(
    `Previous Emulsify component mirror build was interrupted before completion; stale mirrored files may exist. Marker: ${markerFile}`,
  );
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
    writeBundle() {
      if (!enabled) return;
      const markerFile = join(outDir, MIRROR_STATE_FILE);
      warnOnInterruptedMirror(markerFile);

      const startedAt = new Date().toISOString();
      const mirrorState = {
        startedAt,
        completedAt: null,
        version: resolvePackageVersion(projectDir),
      };
      writeMirrorState(markerFile, mirrorState);

      // Vite has written files by writeBundle, while closeBundle can overlap
      // with the next watch cycle observing a partially mirrored dist tree.
      const distComponents = join(outDir, 'components');
      if (safeExists(distComponents)) {
        for (const srcFile of walkFiles(distComponents)) {
          const relFromOutDir = srcFile.slice(join(outDir, '').length);
          const destFile = join(projectDir, relFromOutDir);

          try {
            moveFileIntoPlace(srcFile, destFile);
            pruneEmptyDirsUpTo(dirname(srcFile), distComponents);
          } catch (e) {
            console.warn(
              `Mirror copy failed for ${relFromOutDir}: ${e?.message || e}`,
            );
          }
        }

        pruneEmptyDirsUpTo(distComponents, outDir);
      }

      writeMirrorState(markerFile, {
        ...mirrorState,
        completedAt: new Date().toISOString(),
      });
    },
  };
}
