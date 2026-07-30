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
 * @param {{
 *   entries?: Record<string, string>,
 *   sourceRootRecords?: Array<{name: string, directory: string}>,
 *   projectDir?: string
 * }} options - Attribution inputs.
 * @returns {Array<{name: string, path: string, count: number}>} Input rows.
 */
export function buildInputRows({
  entries = {},
  sourceRootRecords = [],
  projectDir,
} = {}) {
  if (sourceRootRecords.length === 0) return [];

  const counts = new Map(sourceRootRecords.map((root) => [root.directory, 0]));

  for (const sourceFile of Object.values(entries)) {
    if (typeof sourceFile !== 'string') continue;

    // `findSourceRoot` returns the first containing root, and component roots
    // precede global roots in `sourceRootRecords`. That ordering is what keeps a
    // component stylesheet attributed to `components` rather than to the `src`
    // directory that also contains it.
    const root = findSourceRoot(sourceFile, sourceRootRecords);
    if (!root) continue;

    counts.set(root.directory, (counts.get(root.directory) || 0) + 1);
  }

  return sourceRootRecords.map((root) => ({
    name: root.name,
    path: displayRoot(root.directory, projectDir),
    count: counts.get(root.directory) || 0,
  }));
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
