/**
 * @file Source file discovery helpers shared by Emulsify Vite copy plugins.
 *
 * This module walks resolved source roots once, then exposes filtered views for
 * component and global files so copy plugins share the same filesystem model.
 */

import { readdirSync } from 'fs';
import { join, relative, sep } from 'path';

import { relativeFrom } from '../project-structure.js';

const DEFAULT_SKIP_DIRS = [
  'node_modules',
  '.git',
  '.cache',
  '.vite',
  '.out',
  '.coverage',
  'dist',
];

/**
 * Depth-first walk to list every file under a given root.
 *
 * @param {string} rootDir - Directory to traverse.
 * @param {{
 *   shouldSkipDir?: (dir: string) => boolean,
 *   useDefaultSkips?: boolean
 * }} [options] - Traversal options.
 * @returns {string[]} Absolute file paths.
 */
export function walkFiles(
  rootDir,
  { shouldSkipDir = () => false, useDefaultSkips = true } = {},
) {
  const files = [];
  const stack = [rootDir];

  while (stack.length) {
    const currentDir = stack.pop();
    if (!currentDir) continue;

    let entryNames = [];
    try {
      entryNames = readdirSync(currentDir, { withFileTypes: true }).sort(
        (a, b) => a.name.localeCompare(b.name),
      );
    } catch {
      // Skip unreadable directories and keep walking the remaining stack.
      continue;
    }

    for (const entry of entryNames) {
      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (shouldSkipDir(fullPath)) continue;
        if (useDefaultSkips && DEFAULT_SKIP_DIRS.includes(entry.name)) {
          continue;
        }
        stack.push(fullPath);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

/**
 * Determine whether a directory is the same as, or nested inside, another one.
 *
 * @param {string} candidateDir - Directory to test.
 * @param {string} rootDir - Boundary directory.
 * @returns {boolean} TRUE when candidateDir is the root or inside it.
 */
export function isSameOrInsideDir(candidateDir, rootDir) {
  const rel = relative(rootDir, candidateDir);
  return !rel || (!rel.startsWith('..') && !rel.includes(`..${sep}`));
}

/**
 * Determine whether a file is component metadata copied beside Twig templates.
 *
 * @param {string} filePath - Absolute or relative file path.
 * @returns {boolean} TRUE for component metadata files.
 */
export const isComponentMetadataFile = (filePath) =>
  /\.component\.(yml|yaml|json)$/i.test(filePath);

/**
 * Determine whether a file should be copied by the static asset pass.
 *
 * @param {string} filePath - Absolute or relative file path.
 * @returns {boolean} TRUE for non-code source assets.
 */
export const isStaticSourceAsset = (filePath) =>
  !/\.(jsx?|scss|twig|map)$/i.test(filePath) &&
  !isComponentMetadataFile(filePath);

/**
 * Build the roots that should not be crawled during a global source pass.
 *
 * @param {{ directory: string }} globalRoot - Global source root record.
 * @param {{ directory: string }[]} componentRoots - Component source root records.
 * @returns {string[]} Directory paths to skip.
 */
const globalTraversalSkipRoots = (globalRoot, componentRoots) => {
  const configuredSkips = [
    join(globalRoot.directory, 'components'),
    join(globalRoot.directory, 'util'),
  ];
  const nestedComponentRoots = componentRoots
    .map((root) => root.directory)
    .filter(
      (directory) =>
        directory !== globalRoot.directory &&
        isSameOrInsideDir(directory, globalRoot.directory),
    );

  return [...configuredSkips, ...nestedComponentRoots];
};

/**
 * Create a lazy, shared index of files under the resolved project source roots.
 * Accessors return the same array reference between calls for a single index
 * instance once the file tree has been built.
 *
 * @param {object} structure - Resolved project structure.
 * @returns {{
 *   all: () => Array<object>,
 *   componentFiles: () => Array<object>,
 *   globalFiles: () => Array<object>
 * }} Indexed file accessors.
 */
export function createSourceFileIndex(structure) {
  let indexedFiles = null;
  let componentFilesArr = null;
  let globalFilesArr = null;

  const indexRoot = (root, rootType, options = {}) =>
    walkFiles(root.directory, options).map((absPath) => ({
      absPath,
      relPath: relativeFrom(absPath, root.directory),
      root,
      rootType,
    }));

  const build = () => {
    if (indexedFiles) return indexedFiles;

    componentFilesArr = structure.componentRootRecords.flatMap((root) =>
      indexRoot(root, 'component'),
    );
    globalFilesArr = structure.globalRootRecords.flatMap((root) => {
      const skipRoots = globalTraversalSkipRoots(
        root,
        structure.componentRootRecords,
      );

      return indexRoot(root, 'global', {
        shouldSkipDir: (directory) =>
          skipRoots.some((skipRoot) => isSameOrInsideDir(directory, skipRoot)),
      });
    });

    indexedFiles = [...componentFilesArr, ...globalFilesArr];
    return indexedFiles;
  };

  return {
    all: build,
    componentFiles: () => {
      build();
      return componentFilesArr;
    },
    globalFiles: () => {
      build();
      return globalFilesArr;
    },
  };
}
