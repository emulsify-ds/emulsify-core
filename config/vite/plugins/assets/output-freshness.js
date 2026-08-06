/**
 * @file Where a built file lands, and whether it is already there.
 *
 * Shared by every plugin that writes into the output tree during a watch build.
 * Vite used to empty that tree at the start of each rebuild, so nothing was
 * ever up to date and each of these plugins wrote unconditionally;
 * `stableWatchOutputPlugin` stops the emptying after the first cycle, which is
 * what makes a freshness check meaningful at all.
 */

import { closeSync, openSync, readFileSync, readSync, statSync } from 'fs';
import { join } from 'path';

import { safeExists } from '../../utils/fs-safe.js';

const FILE_COMPARE_CHUNK_SIZE = 64 * 1024;

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
 * Read an emitted asset source as a buffer.
 *
 * @param {string|Uint8Array} source - Emitted asset source.
 * @returns {Buffer} Asset bytes.
 */
const toBuffer = (source) =>
  typeof source === 'string'
    ? Buffer.from(source, 'utf8')
    : Buffer.from(source);

/**
 * Determine whether an in-memory source already exists on disk unchanged.
 *
 * @param {string} filePath - Absolute path the bytes would occupy.
 * @param {string|Uint8Array} source - Bytes about to be written.
 * @returns {boolean} TRUE when writing would be a no-op.
 */
export function bytesAlreadyOnDisk(filePath, source) {
  if (!safeExists(filePath)) return false;

  try {
    return readFileSync(filePath).equals(toBuffer(source));
  } catch {
    return false;
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
