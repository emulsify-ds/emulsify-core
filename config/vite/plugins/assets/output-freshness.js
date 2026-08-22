/**
 * @file Where a built file lands, and whether it is already there.
 *
 * Shared by every plugin that writes into the output tree during a watch build.
 * Vite used to empty that tree at the start of each rebuild, so nothing was
 * ever up to date and each of these plugins wrote unconditionally;
 * `stableWatchOutputPlugin` stops the emptying after the first cycle, which is
 * what makes a freshness check meaningful at all.
 */

import {
  closeSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
  unlinkSync,
} from 'fs';
import { join } from 'path';

const FILE_COMPARE_CHUNK_SIZE = 64 * 1024;

/**
 * Remove a destination symlink without following it.
 *
 * A stale output symlink must never survive until a copy: `copyFileSync` follows
 * its destination and would overwrite the link target. Missing destinations
 * are safe; inspection or unlink failures propagate so callers cannot proceed
 * with an unsafe write.
 *
 * @param {string} filePath - Destination path to inspect.
 * @returns {boolean} TRUE when a symlink was removed.
 */
export const removeDestinationSymlink = (filePath) => {
  let stats;

  try {
    stats = lstatSync(filePath);
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return false;
    throw error;
  }

  if (stats.isSymbolicLink()) {
    unlinkSync(filePath);
    return true;
  }

  return false;
};

/**
 * Inspect a destination without following symlinks.
 *
 * @param {string} filePath - Destination path to inspect.
 * @returns {import('fs').Stats|null} Destination stats, or null when absent or removed.
 */
const destinationStatsForComparison = (filePath) => {
  if (removeDestinationSymlink(filePath)) return null;

  try {
    return lstatSync(filePath);
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return null;
    throw error;
  }
};

/**
 * Determine whether two files already contain the same bytes.
 *
 * Small files are read directly; larger files are compared in fixed-size chunks
 * so a build phase does not transiently allocate both complete file bodies.
 *
 * @param {string} sourceFile - Source file path.
 * @param {string} destinationFile - Destination file path.
 * @returns {boolean} TRUE when both files have identical bytes.
 */
export const filesHaveSameBytes = (sourceFile, destinationFile) => {
  const destinationStats = destinationStatsForComparison(destinationFile);
  if (!destinationStats?.isFile()) return false;

  try {
    const sourceStats = statSync(sourceFile);
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
 * Read an emitted asset source as a buffer.
 *
 * @param {string|Uint8Array} source - Emitted asset source.
 * Uint8Array sources are returned directly: Buffer comparisons accept them,
 * so copying the complete asset would only add transient memory pressure.
 *
 * @returns {Buffer|Uint8Array} Asset bytes.
 */
const toBytes = (source) =>
  typeof source === 'string' ? Buffer.from(source, 'utf8') : source;

/**
 * Determine whether an in-memory source already exists on disk unchanged.
 *
 * @param {string} filePath - Absolute path the bytes would occupy.
 * @param {string|Uint8Array} source - Bytes about to be written.
 * @returns {boolean} TRUE when writing would be a no-op.
 */
export function bytesAlreadyOnDisk(filePath, source) {
  const destinationStats = destinationStatsForComparison(filePath);
  if (!destinationStats?.isFile()) return false;

  const sourceBytes = toBytes(source);
  if (destinationStats.size !== sourceBytes.byteLength) return false;
  if (destinationStats.size === 0) return true;

  let handle;

  try {
    handle = openSync(filePath, 'r');
    const destinationBuffer = Buffer.allocUnsafe(FILE_COMPARE_CHUNK_SIZE);
    let position = 0;

    while (position < destinationStats.size) {
      const bytesToRead = Math.min(
        FILE_COMPARE_CHUNK_SIZE,
        destinationStats.size - position,
      );
      const bytesRead = readSync(
        handle,
        destinationBuffer,
        0,
        bytesToRead,
        position,
      );

      if (bytesRead === 0) return false;
      if (
        !destinationBuffer
          .subarray(0, bytesRead)
          .equals(sourceBytes.subarray(position, position + bytesRead))
      ) {
        return false;
      }
      position += bytesRead;
    }

    return true;
  } catch {
    return false;
  } finally {
    if (handle !== undefined) {
      try {
        closeSync(handle);
      } catch {
        /* noop */
      }
    }
  }
}

/**
 * Resolve where an output-relative file ends up once the build finishes.
 *
 * Drupal projects that author under `src/` have their component output moved
 * out of `dist/` by `mirrorComponentsToRoot`, so the previous cycle's copy is
 * not in the output directory to compare against — it is one directory level
 * up, beside the theme's other components. Comparing against the wrong location
 * makes every component file look new, which both defeats the freshness check
 * and leaves the transient write-then-move churn in place.
 *
 * @param {string} relPath - Path relative to the output directory.
 * @param {{outDir: string, projectDir: string, mirrored?: boolean}} paths - Resolved locations.
 * @returns {string} Absolute path the file occupies after the build.
 */
export function resolveFinalPath(relPath, { outDir, projectDir, mirrored }) {
  if (mirrored && relPath.startsWith('components/')) {
    return join(projectDir, relPath);
  }

  return join(outDir, relPath);
}
