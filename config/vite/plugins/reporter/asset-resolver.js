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
import { basename, dirname, posix, relative, resolve } from 'node:path';

import { walkFiles } from '../assets/source-file-index.js';

/**
 * Directories worth skipping on top of the shared defaults.
 *
 * @type {string[]}
 */
const EXTRA_SKIP_DIRS = ['vendor', '.ddev', '.lando', 'storybook-static'];

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
 * Stylesheets a human actually edits.
 *
 * @type {RegExp}
 */
const AUTHORED_STYLESHEET = /\.(scss|sass)$/i;

/**
 * Any stylesheet, including compiled output.
 *
 * @type {RegExp}
 */
const ANY_STYLESHEET = /\.(scss|sass|css)$/i;

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
 * @param {{projectDir?: string}} env - Project environment.
 * @returns {{
 *   locate: (url: string) => {status: string, label: string},
 *   references: (url: string) => Array<{file: string, line: number}>
 * }} Resolver.
 */
export function createAssetResolver({ projectDir = '' } = {}) {
  // Deliberately not `sourceFileIndex`. That index only covers component and
  // global *source* roots, so a theme keeping its images in a project-root
  // `assets/` directory — the Emulsify default — has none of them indexed, and
  // every URL resolves as "not found". Walking the project root instead covers
  // assets, src, and components wherever a project happens to put them.
  //
  // The walk is lazy and cached, so a build with no unresolved URLs never
  // performs it, and one with ten pays for it once.
  /** @type {string[]|undefined} */
  let cachedFiles;

  /**
   * List every project file worth searching.
   *
   * @returns {string[]} Absolute file paths.
   */
  const allFiles = () => {
    if (cachedFiles) return cachedFiles;

    try {
      cachedFiles = projectDir
        ? walkFiles(projectDir, {
            shouldSkipDir: (directory) =>
              EXTRA_SKIP_DIRS.includes(basename(directory)),
          })
        : [];
    } catch {
      // A build summary must never be the thing that breaks a build.
      cachedFiles = [];
    }

    return cachedFiles;
  };

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
      const files = allFiles();
      if (files.length === 0) return { status: 'unknown', label: '' };

      const name = basename(cleanUrl(url));
      const hits = files.filter((file) => basename(file) === name);

      if (hits.length === 0) return { status: 'missing', label: 'not found' };
      if (hits.length > 1) {
        return { status: 'ambiguous', label: `${hits.length} candidates` };
      }

      // The full path, not just the directory: assets are commonly nested a
      // few levels deep and the subfolder is the part that differs from what
      // the stylesheet wrote.
      return { status: 'found', label: toProjectPath(hits[0], projectDir) };
    },

    /**
     * Locate the first of several candidate filenames that exists.
     *
     * Sass tries a handful of names for one specifier, so the lookup has to
     * try them in the same order rather than matching a single basename.
     *
     * @param {string[]} candidates - Candidate basenames, most likely first.
     * @returns {{status: 'found'|'missing'|'unknown', label: string}} Location.
     */
    locateAny(candidates = []) {
      const files = allFiles();
      if (files.length === 0) return { status: 'unknown', label: '' };

      for (const candidate of candidates) {
        const hit = files.find((file) => basename(file) === candidate);
        if (hit) {
          return { status: 'found', label: toProjectPath(hit, projectDir) };
        }
      }

      return { status: 'missing', label: 'not found' };
    },

    /**
     * Find the stylesheets that write this URL, with line numbers.
     *
     * @param {string} url - Unresolved asset URL.
     * @returns {Array<{file: string, line: number}>} References, in file order.
     */
    references(url) {
      const files = allFiles();
      const name = basename(cleanUrl(url));

      /**
       * Collect matches across a set of stylesheets using one predicate.
       *
       * @param {string[]} stylesheets - Files to search.
       * @param {(source: string) => Array<number>} findOffsets - Offset finder.
       * @returns {Array<{file: string, line: number}>} Matches.
       */
      const scan = (stylesheets, findOffsets) => {
        const found = [];

        for (const absPath of stylesheets) {
          const source = read(absPath);
          if (!source) continue;

          for (const offset of findOffsets(source)) {
            found.push({
              file: tailSegments(toProjectPath(absPath, projectDir)),
              line: lineAt(source, offset),
            });
          }
        }

        return found.sort(
          (a, b) => a.file.localeCompare(b.file) || a.line - b.line,
        );
      };

      /**
       * Offsets of every `url()` whose specifier satisfies a predicate.
       *
       * @param {(specifier: string) => boolean} matches - Specifier predicate.
       * @returns {(source: string) => Array<number>} Offset finder.
       */
      const urlCalls = (matches) => (source) =>
        [...source.matchAll(URL_CALL)]
          .filter((match) => matches(match[2].trim()))
          .map((match) => match.index);

      /**
       * Offsets of the bare filename anywhere in a source.
       *
       * @param {string} source - File contents.
       * @returns {Array<number>} Match offsets.
       */
      const bareFilename = (source) => {
        const offsets = [];
        let offset = source.indexOf(name);

        while (offset !== -1) {
          offsets.push(offset);
          offset = source.indexOf(name, offset + name.length);
        }

        return offsets;
      };

      const finders = [
        // Tier 1: the URL is written literally. Precise, and the common case.
        urlCalls((specifier) => specifier === url),

        // Tier 2: the path is interpolated, as in `url('#{$path}/x.png')`, so
        // the resolved URL never appears literally but the filename does.
        urlCalls(
          (specifier) => specifier === name || specifier.endsWith(`/${name}`),
        ),

        // Tier 3: the whole path lives in a variable, so `url()` holds only the
        // variable name. The declaration is still the line to edit.
        bareFilename,
      ];

      // Authored stylesheets are searched exhaustively before compiled CSS is
      // considered at all. Drupal themes that mirror component output back to
      // the project root keep generated CSS beside their source, and a match
      // there points at a one-line build artifact nobody can usefully edit.
      const searchOrder = [
        files.filter((file) => AUTHORED_STYLESHEET.test(file)),
        files.filter((file) => ANY_STYLESHEET.test(file)),
      ];

      for (const stylesheets of searchOrder) {
        for (const findOffsets of finders) {
          const found = scan(stylesheets, findOffsets);
          if (found.length > 0) return found;
        }
      }

      return [];
    },
  };
}

/**
 * Candidate filenames Sass would try for an import specifier.
 *
 * Sass resolves `grid/grid-item` to `_grid-item.scss` before `grid-item.scss`,
 * and a bare directory to its `_index` partial.
 *
 * @param {string} specifier - Import specifier.
 * @returns {string[]} Candidate basenames.
 */
export function sassImportCandidates(specifier) {
  const name = basename(specifier);

  return [
    `_${name}.scss`,
    `${name}.scss`,
    `_${name}.sass`,
    `${name}.sass`,
    '_index.scss',
    '_index.sass',
  ];
}

/**
 * Build rows for the missing-import table.
 *
 * Each row keeps the importing site and the specifier as written. The on-disk
 * column distinguishes a partial that was deleted from one that merely moved,
 * which is the difference between rewriting an import and restoring a file.
 *
 * @param {Array<{file?: string, line?: number, specifier: string}>} errors - Import errors.
 * @param {ReturnType<createAssetResolver>} resolver - Asset resolver.
 * @param {string} projectDir - Project root.
 * @returns {Array<{where: string, specifier: string, status: string, label: string, expected: string|undefined}>} Rows.
 */
export function buildImportRows(errors, resolver, projectDir = '') {
  const rows = errors.map((error) => {
    const found = resolver.locateAny(sassImportCandidates(error.specifier));

    // Where the specifier would have landed, used to derive the shared
    // directory that every failing import points into.
    const expected =
      error.file && error.specifier
        ? resolve(dirname(error.file), error.specifier)
        : undefined;

    return {
      where: `${tailSegments(toProjectPath(error.file || '', projectDir))}${
        error.line == null ? '' : `:${error.line}`
      }`,
      specifier: error.specifier,
      expected,
      ...(found.status === 'found'
        ? { status: 'moved', label: `moved? ${found.label}` }
        : found),
    };
  });

  // Sorted on the shortened path that is actually displayed, so the column
  // reads in order rather than by the absolute paths behind it.
  return rows.sort(
    (a, b) =>
      a.where.localeCompare(b.where) || a.specifier.localeCompare(b.specifier),
  );
}

/**
 * Derive the deepest directory every failing import points into.
 *
 * When one deleted directory breaks a dozen imports, naming it once explains
 * the whole failure better than any individual row can.
 *
 * @param {Array<{expected?: string}>} rows - Import rows.
 * @param {string} projectDir - Project root.
 * @returns {string|undefined} Shared project-relative directory.
 */
export function sharedMissingDirectory(rows, projectDir = '') {
  const directories = rows
    .map((row) => row.expected && dirname(row.expected))
    .filter(Boolean)
    .map((directory) => toProjectPath(directory, projectDir).split('/'));

  if (directories.length === 0) return undefined;

  const [first, ...rest] = directories;
  const shared = [];

  for (let index = 0; index < first.length; index += 1) {
    const segment = first[index];
    if (!rest.every((parts) => parts[index] === segment)) break;
    shared.push(segment);
  }

  // A single shared segment is usually just `src`, which explains nothing.
  return shared.length > 1 ? `${posix.join(...shared)}/` : undefined;
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
