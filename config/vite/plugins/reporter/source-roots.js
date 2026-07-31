/**
 * @file Source root attribution for the Emulsify develop reporter.
 *
 * The reporter's facts block answers a question nothing in the previous output
 * answered: which directories is Emulsify actually reading, and how much did it
 * find in each. On a misconfigured project that is the first thing worth
 * knowing, and a total entry count cannot tell you — 39 entries looks healthy
 * whether or not `src/layout/` was discovered at all.
 *
 * Everything here is derived from data the build already resolved. The entry map
 * is built before the reporter runs, and `sourceRootRecords` comes from the
 * project structure, so attribution costs one pass over the entries and no
 * filesystem access.
 */

import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { statSync } from 'node:fs';

import { findSourceRoot, relativeFrom } from '../../project-structure.js';

/**
 * Render one source root as a display path.
 *
 * Roots are shown relative to the project with a trailing slash, because the
 * trailing slash is what makes a bare name like `components` read as a
 * directory rather than a namespace. Roots resolving outside the project keep
 * their absolute path rather than a `../../` climb, which is unreadable.
 *
 * @param {string} directory - Absolute root directory.
 * @param {string} [projectDir] - Absolute project root.
 * @returns {string} Display path with trailing slash.
 */
export function displayRoot(directory, projectDir) {
  if (!directory) return '';
  if (!projectDir) return `${directory.replace(/\/+$/, '')}/`;

  const relative = relativeFrom(directory, projectDir);
  if (!relative || relative.startsWith('..')) {
    return `${directory.split('\\').join('/').replace(/\/+$/, '')}/`;
  }

  return `${relative.replace(/\/+$/, '')}/`;
}

/**
 * Name the directory the watcher is actually watching.
 *
 * The summary used to close with `watching dist/`, which named the wrong end of
 * the pipeline: `dist/` is written, not watched. Rollup watches the module graph,
 * whose roots are the source roots reported directly above in the input rows, so
 * the honest label is the directory those roots share.
 *
 * A shared parent is preferred over listing each root because it is both shorter
 * and still true — watching `src/` covers `src/components/` and `src/base/`. When
 * the roots share nothing above the project itself, no path describes the set and
 * the generic label is used rather than an inaccurate one.
 *
 * @param {{
 *   sourceRootRecords?: Array<{directory: string}>,
 *   projectDir?: string,
 *   fallback?: string
 * }} [options] - Watch label inputs.
 * @returns {string} Display path of the watched directory.
 */
export function watchedRootLabel({
  sourceRootRecords = [],
  projectDir,
  fallback = 'sources',
} = {}) {
  const paths = sourceRootRecords
    .map((root) => displayRoot(root.directory, projectDir))
    .filter(Boolean);

  return sharedRootPath(paths) || fallback;
}

/**
 * Reduce a set of display paths to the deepest directory all of them sit inside.
 *
 * @param {string[]} paths - Display paths with trailing slashes.
 * @returns {string|undefined} Shared path with a trailing slash, when one exists.
 */
export function sharedRootPath(paths = []) {
  if (paths.length === 0) return undefined;

  const segmentLists = paths.map((path) =>
    path.split('/').filter((segment) => segment !== ''),
  );

  const [first, ...rest] = segmentLists;
  const shared = [];

  for (let index = 0; index < first.length; index += 1) {
    const segment = first[index];
    if (!rest.every((list) => list[index] === segment)) break;
    shared.push(segment);
  }

  // Every root being the same directory leaves that directory shared in full,
  // which is the correct answer. Sharing nothing means the roots sit in unrelated
  // trees, and the caller decides what to say about that.
  if (shared.length === 0) return undefined;

  // A root resolving outside the project keeps its absolute path, and dropping
  // the leading slash off that would name a directory that does not exist.
  const prefix = paths.every((path) => path.startsWith('/')) ? '/' : '';

  return `${prefix}${shared.join('/')}/`;
}

/**
 * Conventional global directory names, in the order they are listed.
 *
 * A project without `variant.structureImplementations` gets one global root, and
 * it is the source directory itself — not a `global/` subdirectory of it. So
 * every entry outside the component roots would attribute to a single `src/` row,
 * which reports a number without saying where any of it came from. Every
 * directory one level inside the root is therefore given its own row.
 *
 * These names sort first so the conventional layout reads the same way across
 * projects; everything else follows alphabetically. Ordering is the only thing
 * this list controls — an unlisted directory still gets a row.
 *
 * This is a reporting distinction only. The build already treats every directory
 * under a global root the same way, emitting each to `dist/global/<name>/`, and
 * nothing here changes that.
 *
 * @type {string[]}
 */
export const GLOBAL_DIRECTORY_ORDER = ['foundation', 'base', 'global'];

/**
 * Maximum number of directories broken out of one global root.
 *
 * Only directories that produced build entries get a row, which on a real
 * project is a handful. The cap is what keeps that a guarantee rather than an
 * observation, so an unconventional `src/` cannot push the build result off the
 * top of the terminal.
 *
 * @type {number}
 */
export const MAX_GLOBAL_DIRECTORY_ROWS = 8;

/**
 * Resolve the directory one level inside a global root that an entry sits in.
 *
 * @param {string} sourceFile - Absolute source file path.
 * @param {string} rootDirectory - Absolute global root directory.
 * @returns {string|undefined} Directory name, when the entry is inside one.
 */
function globalAssetDirectory(sourceFile, rootDirectory) {
  const relative = relativeFrom(sourceFile, rootDirectory);
  if (!relative || relative.startsWith('..')) return undefined;

  const [segment, ...rest] = relative.split('/');

  // A bare file directly inside the root has no directory to attribute to, so it
  // belongs on the root's own row rather than inventing one from the filename.
  if (rest.length === 0) return undefined;

  return segment || undefined;
}

/**
 * Order the directories broken out of one global root.
 *
 * @param {Iterable<string>} names - Discovered directory names.
 * @returns {string[]} Names in display order.
 */
function orderGlobalDirectories(names) {
  const rank = (name) => {
    const index = GLOBAL_DIRECTORY_ORDER.indexOf(name);
    return index === -1 ? GLOBAL_DIRECTORY_ORDER.length : index;
  };

  return [...names].sort(
    (a, b) => rank(a) - rank(b) || a.localeCompare(b, 'en'),
  );
}

/**
 * Attribute build entries to the source roots that produced them.
 *
 * Roots are reported in `sourceRootRecords` order so a project's configured
 * `variant.structureImplementations` order is preserved rather than sorted into
 * something the author did not write.
 *
 * A root that matched nothing is still reported, with a count of zero. That is
 * the single most useful row in the block: a configured root sitting at zero is
 * either misspelled in `project.emulsify.json` or empty on disk, and hiding it
 * would hide the bug.
 *
 * Global roots additionally break out the directories one level inside them,
 * because a global root is the source directory itself and a bare `src/` row
 * reports a number without saying where any of it came from. Files sitting
 * directly in the root have no directory to attribute to and stay on the root's
 * own row. {@link MAX_GLOBAL_DIRECTORY_ROWS} bounds the split.
 *
 * @param {{
 *   entries?: Record<string, string>,
 *   sourceRootRecords?: Array<{name: string, directory: string}>,
 *   globalRootDirectories?: string[],
 *   projectDir?: string
 * }} options - Attribution inputs.
 * @returns {Array<{name: string, path: string, count: number, overflow?: boolean}>} Input rows.
 */
export function buildInputRows({
  entries = {},
  sourceRootRecords = [],
  globalRootDirectories = [],
  projectDir,
} = {}) {
  if (sourceRootRecords.length === 0) return [];

  // Only roots the project structure reported as global are split. A project
  // whose `structureImplementations` happens to name a root `global` has it as a
  // component root, and splitting that would invent rows it did not ask for.
  const globalRoots = new Set(globalRootDirectories);

  const counts = new Map(sourceRootRecords.map((root) => [root.directory, 0]));
  /** @type {Map<string, Map<string, number>>} */
  const globalCounts = new Map();

  for (const sourceFile of Object.values(entries)) {
    if (typeof sourceFile !== 'string') continue;

    // `findSourceRoot` returns the first containing root, and component roots
    // precede global roots in `sourceRootRecords`. That ordering is what keeps a
    // component stylesheet attributed to `components` rather than to the `src`
    // directory that also contains it.
    const root = findSourceRoot(sourceFile, sourceRootRecords);
    if (!root) continue;

    const directory = globalRoots.has(root.directory)
      ? globalAssetDirectory(sourceFile, root.directory)
      : undefined;

    if (!directory) {
      counts.set(root.directory, (counts.get(root.directory) || 0) + 1);
      continue;
    }

    if (!globalCounts.has(root.directory)) {
      globalCounts.set(root.directory, new Map());
    }

    const byDirectory = globalCounts.get(root.directory);
    byDirectory.set(directory, (byDirectory.get(directory) || 0) + 1);
  }

  return sourceRootRecords.flatMap((root) => {
    const byDirectory = globalCounts.get(root.directory);
    const rootCount = counts.get(root.directory) || 0;

    const rows = [];

    // Directories are listed in convention order rather than by count, so the
    // block reads the same way across projects. Anything past the cap collapses
    // into one row that still carries its entries, so the counts reconcile
    // against the total however many directories a project has.
    if (byDirectory) {
      const names = orderGlobalDirectories(byDirectory.keys());
      const shown = names.slice(0, MAX_GLOBAL_DIRECTORY_ROWS);
      const hidden = names.slice(MAX_GLOBAL_DIRECTORY_ROWS);

      for (const name of shown) {
        rows.push({
          name,
          path: displayRoot(`${root.directory}/${name}`, projectDir),
          count: byDirectory.get(name),
        });
      }

      if (hidden.length > 0) {
        rows.push({
          name: root.name,
          path: `+${hidden.length} more ${hidden.length === 1 ? 'directory' : 'directories'}`,
          count: hidden.reduce((sum, name) => sum + byDirectory.get(name), 0),
          overflow: true,
        });
      }
    }

    // The root keeps a row when it holds entries of its own, and when it holds
    // nothing at all — a zero there is still worth seeing. It is dropped only
    // when everything it contained has been attributed to a row above.
    if (rootCount > 0 || rows.length === 0) {
      rows.push({
        name: root.name,
        path: displayRoot(root.directory, projectDir),
        count: rootCount,
      });
    }

    return rows;
  });
}

/**
 * Extensions worth measuring compressed.
 *
 * Gzipping is the expensive part of a per-file table — it is the whole of
 * Rolldown's `computing gzip size...` pause — so it is spent only where the
 * number means something. Fonts and raster images are already compressed and
 * their gzip figure is noise; sourcemaps compress well but are a diagnostic
 * artifact nobody ships to a browser, and they are among the largest files in a
 * typical `dist/`.
 *
 * @type {string[]}
 */
const COMPRESSIBLE_EXTENSIONS = [
  '.css',
  '.js',
  '.mjs',
  '.cjs',
  '.json',
  '.svg',
  '.html',
  '.xml',
  '.txt',
];

/**
 * Determine whether a file's compressed size is worth computing.
 *
 * @param {string} fileName - Output file name.
 * @returns {boolean} TRUE when the file should be gzipped for reporting.
 */
function isCompressible(fileName) {
  const lower = String(fileName).toLowerCase();
  if (lower.endsWith('.map')) return false;

  return COMPRESSIBLE_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

/**
 * Read one bundle output as bytes.
 *
 * @param {{code?: string, source?: string|Uint8Array}} output - Bundle output.
 * @returns {Buffer|undefined} Content, when the output carries any.
 */
function outputBuffer(output) {
  if (!output) return undefined;
  if (typeof output.code === 'string') return Buffer.from(output.code);

  const { source } = output;
  if (typeof source === 'string') return Buffer.from(source);
  if (source && typeof source.byteLength === 'number') {
    return Buffer.from(
      source.buffer || source,
      source.byteOffset,
      source.byteLength,
    );
  }

  return undefined;
}

/**
 * List every entry the build will read, with the size of its source.
 *
 * The quiet reporter answers how many entries each root contributed; this answers
 * which ones. Rows are ordered by path rather than by size because the question
 * a full input listing gets asked is "is everything I expect being compiled" —
 * and that is answered by scanning a tree, not a ranking.
 *
 * Sizes come from one `stat` per entry at config resolution, so this costs
 * nothing on rebuilds and nothing at all outside detailed mode.
 *
 * @param {{
 *   entries?: Record<string, string>,
 *   projectDir?: string
 * }} [options] - Listing inputs.
 * @returns {Array<{path: string, bytes?: number}>} Input file rows.
 */
export function buildInputFileRows({ entries = {}, projectDir } = {}) {
  const rows = [];

  for (const sourceFile of Object.values(entries)) {
    if (typeof sourceFile !== 'string') continue;

    let bytes;
    try {
      bytes = statSync(sourceFile).size;
    } catch {
      // An entry that cannot be stat'd is still worth listing — a path the build
      // resolved but the filesystem does not have is exactly the kind of thing a
      // verbose listing is being read to find.
      bytes = undefined;
    }

    rows.push({ path: displayEntry(sourceFile, projectDir), bytes });
  }

  return rows.sort((a, b) => a.path.localeCompare(b.path, 'en'));
}

/**
 * Render one entry as a display path.
 *
 * @param {string} sourceFile - Absolute source path.
 * @param {string} [projectDir] - Absolute project root.
 * @returns {string} Display path.
 */
function displayEntry(sourceFile, projectDir) {
  const posix = sourceFile.split('\\').join('/');
  if (!projectDir) return posix;

  const relative = relativeFrom(sourceFile, projectDir);

  return !relative || relative.startsWith('..') ? posix : relative;
}

/**
 * List every file a build wrote, with its size and, where useful, its gzip size.
 *
 * Ordered by size descending. Unlike the input listing, the question here is
 * "what is heavy" — the output row already reports the single largest file, and
 * this is that row expanded into the full ranking.
 *
 * @param {Record<string, object>} [bundle] - Rollup output bundle.
 * @param {{gzip?: boolean}} [options] - Listing options.
 * @returns {Array<{fileName: string, bytes: number, gzipBytes?: number}>} Output file rows.
 */
export function buildOutputFileRows(bundle, { gzip = true } = {}) {
  if (!bundle || typeof bundle !== 'object') return [];

  const rows = Object.entries(bundle).map(([fileName, output]) => {
    const content = outputBuffer(output);
    const bytes = content ? content.byteLength : 0;

    let gzipBytes;
    if (gzip && content && isCompressible(fileName)) {
      try {
        gzipBytes = gzipSync(content).byteLength;
      } catch {
        gzipBytes = undefined;
      }
    }

    return { fileName, bytes, gzipBytes };
  });

  return rows.sort(
    (a, b) => b.bytes - a.bytes || a.fileName.localeCompare(b.fileName, 'en'),
  );
}

/**
 * Fingerprint every file in a bundle by content.
 *
 * Rollup regenerates the whole bundle on every watch cycle, so "which files were
 * written" is always "all of them" and says nothing. Comparing content hashes
 * between cycles answers the question actually being asked after an edit: which
 * outputs are different now. It also makes the useful negative reportable — an
 * edit that compiles to byte-identical CSS is worth knowing about.
 *
 * @param {Record<string, object>} [bundle] - Rollup output bundle.
 * @returns {Map<string, string>} File name to content hash.
 */
export function fingerprintBundle(bundle) {
  const fingerprints = new Map();
  if (!bundle || typeof bundle !== 'object') return fingerprints;

  for (const [fileName, output] of Object.entries(bundle)) {
    const content = outputBuffer(output);
    if (!content) continue;

    fingerprints.set(
      fileName,
      createHash('sha1').update(content).digest('hex'),
    );
  }

  return fingerprints;
}

/**
 * Reduce two fingerprint maps to the files that differ.
 *
 * @param {Map<string, string>} previous - Fingerprints from the last cycle.
 * @param {Map<string, string>} current - Fingerprints from this cycle.
 * @returns {{changed: string[], removed: string[]}} Differing file names.
 */
export function diffFingerprints(previous = new Map(), current = new Map()) {
  const changed = [];

  for (const [fileName, hash] of current) {
    // The rule fires on any comparison against a value named like a digest. These
    // hashes identify build output for a terminal listing and guard nothing, so
    // there is no secret to leak through comparison timing.
    // eslint-disable-next-line security/detect-possible-timing-attacks
    if (previous.get(fileName) !== hash) changed.push(fileName);
  }

  const removed = [...previous.keys()].filter(
    (fileName) => !current.has(fileName),
  );

  return { changed: changed.sort(), removed: removed.sort() };
}

/**
 * Reduce a written bundle to the facts worth keeping from Rolldown's table.
 *
 * Raising `logLevel` to quiet the develop loop also discards Rolldown's per-file
 * asset report, which is around seventy lines on a real project. Three of its
 * facts are worth keeping — how many files landed, how much they weigh, and
 * which one is heaviest — and those fit on one line.
 *
 * Sizes are computed from the emitted content rather than by reading `dist/`
 * back off disk, so this adds no I/O to the cycle.
 *
 * @param {Record<string, {type?: string, code?: string, source?: string|Uint8Array}>} [bundle] - Rollup output bundle.
 * @returns {{fileCount: number, totalBytes: number, largest?: {fileName: string, bytes: number}}|undefined} Write tally.
 */
export function summarizeBundle(bundle) {
  if (!bundle || typeof bundle !== 'object') return undefined;

  const files = Object.entries(bundle);
  if (files.length === 0) return undefined;

  let totalBytes = 0;
  let largest;

  for (const [fileName, output] of files) {
    const bytes = outputByteLength(output);
    totalBytes += bytes;

    if (!largest || bytes > largest.bytes) {
      largest = { fileName, bytes };
    }
  }

  return { fileCount: files.length, totalBytes, largest };
}

/**
 * Measure one bundle output in bytes.
 *
 * Chunks carry `code`, assets carry `source`, and an asset source may already be
 * binary. `Buffer.byteLength` is used for strings so multi-byte characters are
 * not undercounted as one byte each.
 *
 * @param {{code?: string, source?: string|Uint8Array}} output - Bundle output.
 * @returns {number} Byte length.
 */
function outputByteLength(output) {
  if (!output) return 0;

  if (typeof output.code === 'string') {
    return Buffer.byteLength(output.code);
  }

  const { source } = output;
  if (typeof source === 'string') return Buffer.byteLength(source);
  if (source && typeof source.byteLength === 'number') return source.byteLength;

  return 0;
}
