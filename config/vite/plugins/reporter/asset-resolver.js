/**
 * @file Enrichment for unresolved CSS asset URLs.
 *
 * Vite reports that a `url()` did not resolve, but not much else. In practice
 * it reports the URL as its own importer, so the raw notice cannot even say
 * which stylesheet to open. That leaves an author with a list of strings and no
 * way to tell a typo from a genuinely missing file.
 *
 * This module answers the two questions the notice leaves open:
 *
 *  - Where is the URL written? Found by parsing `url()` specifiers out of the
 *    project's stylesheets, which also yields a line number.
 *  - Does the file exist anywhere? Found by matching the basename against the
 *    source file index Vite already built for this run.
 *
 * Both lookups run against the in-memory index and only when a build actually
 * produced unresolved URLs, so a clean build pays nothing.
 */

import { readFileSync } from 'node:fs';
import { basename, dirname, relative } from 'node:path';

/**
 * Matches a CSS `url()` call and captures its specifier.
 *
 * The specifier is compared exactly rather than by substring: `images/a.png`
 * appears inside `../images/a.png`, so a substring test attributes a URL to
 * stylesheets that never referenced it.
 *
 * @type {RegExp}
 */
const URL_CALL = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;

/**
 * Stylesheet extensions worth scanning for `url()` references.
 *
 * @type {RegExp}
 */
const STYLESHEET = /\.(scss|sass|css)$/i;

/**
 * Convert an absolute path to a forward-slash path relative to the project.
 *
 * @param {string} filePath - Absolute path.
 * @param {string} projectDir - Project root.
 * @returns {string} Project-relative path.
 */
const toProjectPath = (filePath, projectDir) =>
  relative(projectDir, filePath).split('\\').join('/');

/**
 * Keep the trailing segments of a path so the column stays narrow.
 *
 * @param {string} filePath - Path to shorten.
 * @param {number} [segments] - Segments to keep.
 * @returns {string} Shortened path.
 */
const tailSegments = (filePath, segments = 2) =>
  filePath.split('/').slice(-segments).join('/');

/**
 * Strip a query string or fragment from an asset URL.
 *
 * @param {string} url - Asset URL.
 * @returns {string} URL without suffixes.
 */
const cleanUrl = (url) => url.split('?')[0].split('#')[0];

/**
 * Count the 1-based line number at a character offset.
 *
 * @param {string} source - File contents.
 * @param {number} index - Character offset.
 * @returns {number} 1-based line number.
 */
const lineAt = (source, index) => source.slice(0, index).split('\n').length;

/**
 * Create a resolver for unresolved CSS asset URLs.
 *
 * @param {{
 *   sourceFileIndex?: {all: () => Array<{absPath: string}>},
 *   projectDir?: string
 * }} env - Project environment.
 * @returns {{
 *   locate: (url: string) => {status: string, label: string},
 *   references: (url: string) => Array<{file: string, line: number}>
 * }} Resolver.
 */
export function createAssetResolver({ sourceFileIndex, projectDir = '' } = {}) {
  /** @type {Array<{absPath: string}>} */
  let files = [];
  try {
    files = sourceFileIndex?.all?.() || [];
  } catch {
    // A broken index must not take down the build summary.
    files = [];
  }

  // Stylesheets are read at most once per cycle, however many URLs are checked.
  /** @type {Map<string, string|undefined>} */
  const contents = new Map();

  /**
   * Read a stylesheet, remembering failures so they are not retried.
   *
   * @param {string} absPath - Absolute file path.
   * @returns {string|undefined} File contents.
   */
  const read = (absPath) => {
    if (contents.has(absPath)) return contents.get(absPath);

    let source;
    try {
      source = readFileSync(absPath, 'utf8');
    } catch {
      source = undefined;
    }

    contents.set(absPath, source);
    return source;
  };

  return {
    /**
     * Determine whether the referenced file exists in the project source.
     *
     * Matching is by basename, so a project containing two files of the same
     * name is reported as ambiguous rather than resolved to an arbitrary one.
     *
     * @param {string} url - Unresolved asset URL.
     * @returns {{status: 'found'|'missing'|'ambiguous'|'unknown', label: string}} Location.
     */
    locate(url) {
      if (files.length === 0) return { status: 'unknown', label: '' };

      const name = basename(cleanUrl(url));
      const hits = files.filter((file) => basename(file.absPath) === name);

      if (hits.length === 0) return { status: 'missing', label: 'not found' };
      if (hits.length > 1) {
        return { status: 'ambiguous', label: `${hits.length} candidates` };
      }

      return {
        status: 'found',
        label: `${toProjectPath(dirname(hits[0].absPath), projectDir)}/`,
      };
    },

    /**
     * Find the stylesheets that write this URL, with line numbers.
     *
     * @param {string} url - Unresolved asset URL.
     * @returns {Array<{file: string, line: number}>} References, in file order.
     */
    references(url) {
      const found = [];

      for (const file of files) {
        if (!STYLESHEET.test(file.absPath)) continue;

        const source = read(file.absPath);
        // Cheap reject before running the matcher over the whole file.
        if (!source || !source.includes(url)) continue;

        for (const match of source.matchAll(URL_CALL)) {
          if (match[2].trim() !== url) continue;

          found.push({
            file: tailSegments(toProjectPath(file.absPath, projectDir)),
            line: lineAt(source, match.index),
          });
        }
      }

      return found.sort(
        (a, b) => a.file.localeCompare(b.file) || a.line - b.line,
      );
    },
  };
}

/**
 * Expand unresolved URLs into one row per place they are written.
 *
 * With the stylesheet in the leading column the block reads as a worklist, so
 * every row has to be somewhere to go. A URL written in three stylesheets
 * becomes three rows rather than one row with a repeat count.
 *
 * @param {Array<{url: string}>} assets - Unresolved assets from the collector.
 * @param {ReturnType<createAssetResolver>} resolver - Asset resolver.
 * @returns {Array<{where: string, url: string, status: string, label: string}>} Table rows.
 */
export function buildAssetRows(assets, resolver) {
  const rows = assets.flatMap((asset) => {
    const location = resolver.locate(asset.url);
    const references = resolver.references(asset.url);

    if (references.length === 0) {
      return [{ where: '—', url: asset.url, ...location }];
    }

    return references.map((reference) => ({
      where: `${reference.file}:${reference.line}`,
      url: asset.url,
      ...location,
    }));
  });

  // File order top to bottom matches the order the fixes get made.
  return rows.sort(
    (a, b) => a.where.localeCompare(b.where) || a.url.localeCompare(b.url),
  );
}
