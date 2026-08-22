/**
 * @file Generated source-map filename helpers.
 */

import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { toPosixPath } from './paths.js';

/** URI schemes whose resolution is independent of the map's filesystem path. */
const URI_SCHEME_RE = /^[a-z][a-z\d+.-]*:/i;

/**
 * Determine whether a build output name is a JavaScript or CSS source map.
 *
 * A generic `.map` suffix is not enough: `.map` is also a legitimate asset
 * extension. Core emits JavaScript chunks, while CSS maps can be supplied by a
 * project extension or another Vite pipeline.
 *
 * @param {string} fileName - Output file name.
 * @returns {boolean} TRUE for generated JavaScript and CSS source-map names.
 */
export function isGeneratedSourceMap(fileName) {
  return /\.(?:[cm]?js|css)\.map$/i.test(String(fileName));
}

/**
 * Rebase relative source paths when a generated map is moved on disk.
 *
 * Rollup writes component maps relative to `dist/components/**`. Drupal SDC
 * then moves those files to project-root `components/**`; without rebasing,
 * every relative source keeps one extra parent traversal and points outside
 * the theme. Remote and virtual sources are left untouched. Maps with an
 * explicit sourceRoot are conservatively preserved because that root may use
 * URL rather than filesystem semantics.
 *
 * @param {string} contents - JSON source-map contents.
 * @param {string} sourceMapFile - Original map location.
 * @param {string} destinationMapFile - Final map location.
 * @returns {string} Rebased JSON, or the original contents when it is not safely rewritable.
 */
export function rebaseSourceMapForMove(
  contents,
  sourceMapFile,
  destinationMapFile,
) {
  let sourceMap;
  try {
    sourceMap = JSON.parse(contents);
  } catch {
    return contents;
  }

  if (!Array.isArray(sourceMap?.sources) || sourceMap.sourceRoot) {
    return contents;
  }

  const sourceDirectory = dirname(sourceMapFile);
  const destinationDirectory = dirname(destinationMapFile);
  let changed = false;

  const sources = sourceMap.sources.map((source) => {
    if (typeof source !== 'string' || !source || source.startsWith('\0')) {
      return source;
    }

    let absoluteSource;
    if (source.startsWith('file:')) {
      try {
        absoluteSource = fileURLToPath(source);
      } catch {
        return source;
      }
    } else if (isAbsolute(source)) {
      absoluteSource = source;
    } else {
      if (URI_SCHEME_RE.test(source) || source.startsWith('//')) return source;
      absoluteSource = resolve(sourceDirectory, source);
    }

    const rebased = toPosixPath(relative(destinationDirectory, absoluteSource));
    if (rebased !== source) changed = true;
    return rebased;
  });

  if (!changed) return contents;
  return `${JSON.stringify({ ...sourceMap, sources })}\n`;
}
