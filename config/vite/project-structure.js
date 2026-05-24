/**
 * @file Shared component structure and output path resolution.
 *
 * The helpers here keep source-root discovery, Rollup entry keys, copied asset
 * destinations, Twig namespaces, and Storybook roots aligned.
 */

import fs from 'fs';
import { basename, relative, resolve, sep } from 'path';

/** Normalize filesystem paths to POSIX for Rollup keys and Vite globs. */
export const toPosixPath = (filePath) => filePath.split(sep).join('/');

/** Return truthy values in first-seen order with duplicates removed. */
const unique = (items) => Array.from(new Set(items.filter(Boolean)));

/** Strip a JS or SCSS extension from an output key. */
const stripAssetExtension = (filePath) => filePath.replace(/\.(scss|js)$/i, '');

/** Replace last slash with an injected subdir (e.g., '/css/' or '/js/'). */
export function replaceLastSlash(str, replacement) {
  const i = str.lastIndexOf('/');
  if (i === -1) return str;
  return str.slice(0, i) + replacement + str.slice(i + 1);
}

/** Insert "/css|js" bucket unless SDC=true; strip extension. */
export function injectBucket(rel, bucket, SDC) {
  const withoutExt = stripAssetExtension(rel);
  if (SDC) {
    return bucket === 'css' ? `${withoutExt}__style` : withoutExt;
  }
  return replaceLastSlash(rel, `/${bucket}/`).replace(/\.(scss|js)$/i, '');
}

/**
 * Safe existence check for normalized project paths.
 *
 * @param {string} filePath - Absolute path.
 * @returns {boolean} TRUE when the path exists.
 */
function exists(filePath) {
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

/**
 * Relativize an absolute path from a base directory using POSIX separators.
 *
 * @param {string} absPath - Absolute file path.
 * @param {string} baseDir - Absolute base directory.
 * @returns {string} POSIX relative path.
 */
export function relativeFrom(absPath, baseDir) {
  return toPosixPath(relative(baseDir, absPath));
}

/**
 * Determine whether a file is inside a source root.
 *
 * @param {string} absPath - Absolute file path.
 * @param {string} rootDir - Absolute root path.
 * @returns {boolean} TRUE when the file is inside the root.
 */
function isInsideRoot(absPath, rootDir) {
  const rel = relative(rootDir, absPath);
  return Boolean(rel) && !rel.startsWith('..') && !rel.includes(`..${sep}`);
}

/**
 * Determine whether a path is the same as a root or inside it.
 *
 * @param {string} absPath - Absolute file path.
 * @param {string} rootDir - Absolute root path.
 * @returns {boolean} TRUE when the path is inside or equal to the root.
 */
function isSameOrInsideRoot(absPath, rootDir) {
  return absPath === rootDir || isInsideRoot(absPath, rootDir);
}

/**
 * Find the first source root containing a file.
 *
 * @param {string} absPath - Absolute file path.
 * @param {{name: string, directory: string}[]} roots - Source root records.
 * @returns {{name: string, directory: string}|null} Matching root record.
 */
export function findSourceRoot(absPath, roots = []) {
  return roots.find((root) => isInsideRoot(absPath, root.directory)) || null;
}

/**
 * Build fallback component roots for non-variant projects.
 *
 * The recommended `src/components` root wins when present. If a project has a
 * `src/` directory but no `src/components`, root `./components` remains a valid
 * canonical component source for upgrades.
 *
 * @param {{projectDir: string, srcDir: string, srcExists: boolean}} env
 * @returns {{name: string, directory: string}[]} Component source roots.
 */
function fallbackComponentRoots({ projectDir, srcDir, srcExists }) {
  const primary =
    basename(srcDir) === 'components' ? srcDir : resolve(srcDir, 'components');
  const rootComponents = resolve(projectDir, 'components');
  const candidates = unique([
    primary,
    ...(srcExists ? [rootComponents] : []),
    rootComponents,
  ]);
  const selected = candidates.find(exists) || primary;

  return [{ name: 'components', directory: selected }];
}

/**
 * Build fallback global roots for non-variant projects.
 *
 * @param {{srcDir: string, srcExists: boolean}} env - Project environment.
 * @returns {{name: string, directory: string}[]} Global source roots.
 */
function fallbackGlobalRoots({ srcDir, srcExists }) {
  return srcExists ? [{ name: 'global', directory: srcDir }] : [];
}

/**
 * Build Twig namespace roots for explicit structure implementations.
 *
 * @param {{name: string, directory: string}[]} structureImplementations
 * @returns {Record<string, string>} Namespace roots.
 */
function implementationNamespaceRoots(structureImplementations) {
  const namespaceRoots = {};

  for (const implementation of structureImplementations) {
    if (!implementation.name || namespaceRoots[implementation.name]) continue;
    namespaceRoots[implementation.name] = implementation.directory;
  }

  if (!namespaceRoots.components && structureImplementations[0]?.directory) {
    namespaceRoots.components = structureImplementations[0].directory;
  }

  return namespaceRoots;
}

/**
 * Build Twig namespace roots for legacy/non-variant projects.
 *
 * @param {{projectDir: string, srcDir: string, srcExists: boolean, componentRootRecords: {name: string, directory: string}[]}} env
 * @returns {Record<string, string>} Namespace roots.
 */
function fallbackNamespaceRoots({
  projectDir,
  srcDir,
  srcExists,
  componentRootRecords,
}) {
  const namespaceRoots = {};
  const componentRoot = componentRootRecords[0]?.directory;

  if (componentRoot && exists(componentRoot)) {
    namespaceRoots.components = componentRoot;
  }

  const layoutRoot = unique([
    ...(srcExists ? [resolve(srcDir, 'layout')] : []),
    resolve(projectDir, 'src/layout'),
    resolve(projectDir, 'layout'),
  ]).find(exists);
  const tokensRoot = unique([
    ...(srcExists ? [resolve(srcDir, 'tokens')] : []),
    resolve(projectDir, 'src/tokens'),
    resolve(projectDir, 'tokens'),
  ]).find(exists);

  if (layoutRoot) {
    namespaceRoots.layout = layoutRoot;
  }
  if (tokensRoot) {
    namespaceRoots.tokens = tokensRoot;
  }

  return namespaceRoots;
}

/**
 * Resolve the serializable project structure model.
 *
 * @param {{
 *   projectDir: string,
 *   srcDir: string,
 *   srcExists: boolean,
 *   SDC?: boolean,
 *   structureImplementations?: {name: string, directory: string}[],
 *   platformAdapter?: object
 * }} env - Normalized project environment.
 * @returns {object} Project structure model.
 */
export function resolveProjectStructure(env) {
  const {
    projectDir,
    srcDir,
    srcExists,
    SDC = false,
    platformAdapter = {},
  } = env;
  const structureImplementations =
    Array.isArray(env.structureImplementations) &&
    env.structureImplementations.length
      ? env.structureImplementations
      : Array.isArray(env.structureRoots) && env.structureOverrides
        ? env.structureRoots.map((directory, index) => ({
            name: index === 0 ? 'components' : `structure-${index + 1}`,
            directory,
          }))
        : [];
  const structureOverrides = structureImplementations.length > 0;
  const componentRootRecords = structureOverrides
    ? structureImplementations
    : fallbackComponentRoots({ projectDir, srcDir, srcExists });
  const globalRootRecords = structureOverrides
    ? []
    : fallbackGlobalRoots({ srcDir, srcExists });
  const namespaceRoots = structureOverrides
    ? implementationNamespaceRoots(structureImplementations)
    : fallbackNamespaceRoots({
        projectDir,
        srcDir,
        srcExists,
        componentRootRecords,
      });
  const componentRoots = componentRootRecords.map((root) => root.directory);
  const globalRoots = globalRootRecords.map((root) => root.directory);
  const namespaceRootValues = Object.values(namespaceRoots);
  const sourceRoots = unique([...componentRoots, ...globalRoots]);
  const sourceRootRecords = [...componentRootRecords, ...globalRootRecords];
  const componentStoryRoots = srcExists
    ? componentRoots.filter((root) => !isSameOrInsideRoot(root, srcDir))
    : componentRoots;
  const storyRoots = structureOverrides
    ? componentRoots
    : unique([...(srcExists ? [srcDir] : []), ...componentStoryRoots]);
  const twigRoots = unique([
    ...componentRoots,
    ...namespaceRootValues,
    ...(structureOverrides ? [] : [srcDir]),
  ]);
  const mirrorComponentOutput = Boolean(
    srcExists &&
    !structureOverrides &&
    platformAdapter?.build?.mirrorDistComponentsToRoot,
  );

  return {
    structureOverrides,
    componentRootRecords,
    globalRootRecords,
    componentRoots,
    globalRoots,
    sourceRoots,
    sourceRootRecords,
    storyRoots,
    twigRoots,
    namespaceRoots,
    output: {
      components: 'components',
      global: 'global',
      js: 'js',
      css: 'css',
      storybook: 'storybook',
    },
    outputStrategy: platformAdapter?.outputStrategy || 'dist',
    outputMode: platformAdapter?.outputStrategy || 'dist',
    mirrorComponentOutput,
    SDC: Boolean(SDC),
  };
}

/**
 * Resolve the legacy relative key used by variant structure entries.
 *
 * Existing structure override builds strip the path below the first
 * `components/` segment when one exists, otherwise they keep the project
 * relative path. Preserve that behavior for entry-key compatibility.
 *
 * @param {string} filePath - Absolute source file path.
 * @param {object} structure - Project structure model.
 * @param {string} projectDir - Absolute project root.
 * @returns {string} Project-relative key segment.
 */
function legacyStructureRelative(filePath, structure, projectDir) {
  const relFromProject = relativeFrom(filePath, projectDir);
  const componentRoot = findSourceRoot(
    filePath,
    structure.componentRootRecords,
  );
  if (componentRoot?.name === 'components') {
    return relativeFrom(filePath, componentRoot.directory);
  }
  return relFromProject;
}

/**
 * Resolve an output key for compiled JS or CSS.
 *
 * @param {string} filePath - Absolute source file path.
 * @param {'js'|'css'} type - Asset type.
 * @param {object} structure - Project structure model.
 * @param {{projectDir: string, srcDir: string, SDC?: boolean}} ctx - Build context.
 * @returns {string|null} Output key without extension.
 */
export function compiledAssetOutputPath(filePath, type, structure, ctx) {
  const bucket = type === 'css' ? 'css' : 'js';
  const outputBase =
    bucket === 'css' ? structure.output.css : structure.output.js;

  if (structure.structureOverrides) {
    const rel = legacyStructureRelative(filePath, structure, ctx.projectDir);
    return `${outputBase}/${stripAssetExtension(rel)}`;
  }

  const componentRoot = findSourceRoot(
    filePath,
    structure.componentRootRecords,
  );
  if (componentRoot) {
    const rel = relativeFrom(filePath, componentRoot.directory);
    return `${structure.output.components}/${injectBucket(
      `${structure.output.components}/${rel}`,
      bucket,
      ctx.SDC,
    ).replace(/^components\//, '')}`;
  }

  const globalRoot = findSourceRoot(filePath, structure.globalRootRecords);
  if (globalRoot) {
    const rel = relativeFrom(filePath, globalRoot.directory);
    return `${structure.output.global}/${injectBucket(rel, bucket, ctx.SDC)}`;
  }

  return null;
}

/**
 * Resolve an output key for Storybook/component-library SCSS.
 *
 * @param {string} filePath - Absolute source file path.
 * @param {object} structure - Project structure model.
 * @param {{projectDir: string, srcDir: string}} ctx - Build context.
 * @returns {string} Output key without extension.
 */
export function storybookStyleOutputPath(filePath, structure, ctx) {
  const sourceRoot = findSourceRoot(filePath, structure.sourceRootRecords);
  const relFromSrc = relativeFrom(filePath, ctx.srcDir);
  const rel =
    structure.structureOverrides || relFromSrc.startsWith('../')
      ? structure.structureOverrides
        ? relativeFrom(filePath, ctx.projectDir)
        : relativeFrom(filePath, sourceRoot?.directory || ctx.srcDir)
      : relFromSrc;

  return `${structure.output.storybook}/${rel.replace(/\.scss$/i, '')}`;
}

/**
 * Resolve copied component file destination relative to Vite outDir.
 *
 * @param {string} filePath - Absolute source file path.
 * @param {object} structure - Project structure model.
 * @returns {string|null} OutDir-relative destination.
 */
export function copiedComponentOutputPath(filePath, structure) {
  const componentRoot = findSourceRoot(
    filePath,
    structure.componentRootRecords,
  );
  if (!componentRoot) return null;

  const rel = relativeFrom(filePath, componentRoot.directory);
  const base = structure.structureOverrides
    ? componentRoot.name
    : structure.output.components;
  return `${base}/${rel}`;
}

/**
 * Resolve copied global file destination relative to Vite outDir.
 *
 * @param {string} filePath - Absolute source file path.
 * @param {object} structure - Project structure model.
 * @returns {string|null} OutDir-relative destination.
 */
export function copiedGlobalOutputPath(filePath, structure) {
  const globalRoot = findSourceRoot(filePath, structure.globalRootRecords);
  if (!globalRoot) return null;

  const rel = relativeFrom(filePath, globalRoot.directory);
  if (
    rel === 'components' ||
    rel.startsWith('components/') ||
    rel === 'util' ||
    rel.startsWith('util/')
  ) {
    return null;
  }

  return `${structure.output.global}/${rel}`;
}
