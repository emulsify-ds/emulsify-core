/**
 * @file Generated source-map filename helpers.
 */

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
