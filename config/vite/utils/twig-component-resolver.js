/**
 * @file Node-safe component template resolution shared by Twig compilation and audits.
 *
 * Callers own the grouping-directory cache so a build can invalidate it on
 * filesystem changes and an audit can discard it after each pass.
 */

import fs from 'node:fs';
import { basename, isAbsolute, relative, resolve } from 'node:path';
import { toPosixPath } from './paths.js';
import { unique } from '../../../src/extensions/shared/lists.js';

/**
 * Build likely filesystem candidates for a Twig template reference.
 *
 * @param {string} baseDir - Directory used as the resolution root.
 * @param {string} templatePath - Template path from Twig source.
 * @returns {string[]} Candidate absolute paths.
 */
export const buildTemplateFileCandidates = (baseDir, templatePath) => {
  const normalizedTemplatePath = toPosixPath(templatePath);
  const withoutTwigExt = normalizedTemplatePath.replace(/\.twig$/i, '');
  const stem = basename(withoutTwigExt);

  return unique(
    [
      resolve(baseDir, normalizedTemplatePath),
      resolve(baseDir, `${normalizedTemplatePath}.twig`),
      resolve(baseDir, `${normalizedTemplatePath}.html.twig`),
      resolve(baseDir, withoutTwigExt, `${stem}.twig`),
      resolve(baseDir, withoutTwigExt, `${stem}.html.twig`),
    ].filter(Boolean),
  );
};

/**
 * Determine whether a file path is equal to or below a candidate root.
 *
 * @param {string} root - Absolute root path.
 * @param {string} filePath - Absolute file path.
 * @returns {boolean} TRUE when the file belongs to the root.
 */
export const isWithinRoot = (root, filePath) => {
  const rootRelativePath = relative(root, filePath);
  return (
    rootRelativePath === '' ||
    (!!rootRelativePath &&
      !rootRelativePath.startsWith('..') &&
      !isAbsolute(rootRelativePath))
  );
};

/**
 * Return the first component template candidate contained by its configured root.
 *
 * Both lexical and real paths are checked so `..` segments and symlinks cannot
 * escape the component root.
 *
 * @param {string[]} paths - Candidate absolute paths.
 * @param {string} componentRoot - Absolute component root path.
 * @returns {string|undefined} Existing component template path.
 */
const findExistingComponentTemplateFile = (paths, componentRoot) => {
  const absoluteRoot = resolve(componentRoot);
  let realRoot;

  try {
    realRoot = fs.realpathSync(absoluteRoot);
  } catch {
    return undefined;
  }

  return paths.filter(Boolean).find((filePath) => {
    const absoluteFilePath = resolve(filePath);
    if (!isWithinRoot(absoluteRoot, absoluteFilePath)) {
      return false;
    }

    try {
      return (
        fs.statSync(absoluteFilePath).isFile() &&
        isWithinRoot(realRoot, fs.realpathSync(absoluteFilePath))
      );
    } catch {
      return false;
    }
  });
};

/**
 * Resolve Twig namespace syntax to a namespace root and relative path.
 *
 * @param {string} templatePath - Template reference from Twig source.
 * @param {Record<string, string>} [namespaces={}] - Namespace root map.
 * @returns {{ namespace: string, root: string, path: string }|null}
 *   Namespace lookup result.
 */
export const parseTwigNamespaceReference = (templatePath, namespaces = {}) => {
  const namespaceNames = Object.keys(namespaces);
  const atNamespace = templatePath.match(/^@([^/]+)\/(.+)$/);
  if (atNamespace && namespaces[atNamespace[1]]) {
    return {
      namespace: atNamespace[1],
      root: namespaces[atNamespace[1]],
      path: atNamespace[2],
    };
  }

  const doubleColon = templatePath.match(/^([^:]+)::(.+)$/);
  if (doubleColon && namespaces[doubleColon[1]]) {
    return {
      namespace: doubleColon[1],
      root: namespaces[doubleColon[1]],
      path: doubleColon[2],
    };
  }

  const singleColon = templatePath.match(/^([^:/.]+):(.+)$/);
  if (singleColon && namespaces[singleColon[1]]) {
    return {
      namespace: singleColon[1],
      root: namespaces[singleColon[1]],
      path: singleColon[2],
    };
  }

  const slashNamespace = namespaceNames.find((namespace) =>
    templatePath.startsWith(`${namespace}/`),
  );
  if (slashNamespace) {
    return {
      namespace: slashNamespace,
      // Namespace names come from the normalized Twig namespace map.
      root: namespaces[slashNamespace],
      path: templatePath.slice(slashNamespace.length + 1),
    };
  }

  return null;
};

/**
 * Return grouping directories below the configured component root.
 *
 * Breadth-first traversal preserves direct and one-level behavior before
 * searching deeper groups. Siblings use code-point order so duplicate
 * shorthand names resolve consistently across filesystems.
 *
 * @param {string} componentRoot - Absolute component root path.
 * @param {Map<string, string[]>} componentGroupRootsCache - Caller-scoped directory cache.
 * @returns {string[]} Absolute grouping directory paths.
 */
const componentGroupRoots = (componentRoot, componentGroupRootsCache) => {
  if (!componentRoot) return [];

  const absoluteRoot = resolve(componentRoot);
  if (componentGroupRootsCache.has(absoluteRoot)) {
    return componentGroupRootsCache.get(absoluteRoot);
  }

  const groupRoots = [];
  const pendingDirectories = [absoluteRoot];

  for (let index = 0; index < pendingDirectories.length; index += 1) {
    const directory = pendingDirectories[index];
    let entries;

    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      continue;
    }

    const childDirectories = entries
      .filter((entry) => entry.isDirectory())
      .sort(({ name: left }, { name: right }) =>
        left === right ? 0 : left < right ? -1 : 1,
      )
      .map((entry) => resolve(directory, entry.name))
      .filter((childDirectory) => isWithinRoot(absoluteRoot, childDirectory));

    groupRoots.push(...childDirectories);
    pendingDirectories.push(...childDirectories);
  }

  componentGroupRootsCache.set(absoluteRoot, groupRoots);
  return groupRoots;
};

/**
 * Resolve a component reference through recursively grouped directories.
 *
 * Project-scoped component IDs can use the component name (`project:button`)
 * even when projects organize components under grouping paths such as
 * `atoms/text`.
 *
 * @param {string} templatePath - Component-relative template reference.
 * @param {string} componentRoot - Absolute component root path.
 * @param {Map<string, string[]>} componentGroupRootsCache - Caller-scoped directory cache.
 * @returns {string|null} Existing template path when found.
 */
const resolveGroupedComponentTemplate = (
  templatePath,
  componentRoot,
  componentGroupRootsCache,
) =>
  findExistingComponentTemplateFile(
    componentGroupRoots(componentRoot, componentGroupRootsCache).flatMap(
      (groupRoot) => buildTemplateFileCandidates(groupRoot, templatePath),
    ),
    componentRoot,
  ) || null;

/**
 * Resolve shorthand component references against the components namespace.
 *
 * @param {string} templatePath - Template reference from Twig source.
 * @param {string} componentRoot - Absolute component root path.
 * @param {Map<string, string[]>} componentGroupRootsCache - Caller-scoped directory cache.
 * @returns {string|null} Existing template path when found.
 */
const resolveComponentShorthandReference = (
  templatePath,
  componentRoot,
  componentGroupRootsCache,
) => {
  if (!componentRoot || templatePath.startsWith('.')) return null;

  const shorthandPath =
    templatePath.startsWith('@') && !templatePath.includes('/')
      ? templatePath.slice(1)
      : templatePath;
  const directComponentPath = findExistingComponentTemplateFile(
    buildTemplateFileCandidates(componentRoot, shorthandPath),
    componentRoot,
  );
  if (directComponentPath) {
    return directComponentPath;
  }

  const genericNamespace = templatePath.match(/^@?[^/:]+[:/](.+)$/);
  if (!genericNamespace) {
    return null;
  }

  const genericComponentPath = genericNamespace[1];

  return (
    findExistingComponentTemplateFile(
      buildTemplateFileCandidates(componentRoot, genericComponentPath),
      componentRoot,
    ) ||
    resolveGroupedComponentTemplate(
      genericComponentPath,
      componentRoot,
      componentGroupRootsCache,
    )
  );
};

/**
 * Resolve component namespace paths and project-scoped component shorthand.
 *
 * Configured non-component namespaces remain scoped to their own roots. Direct
 * candidates precede grouped candidates, which retain breadth-first/code-point
 * order for duplicate component names.
 *
 * @param {string} templatePath - Template reference from Twig source.
 * @param {Record<string, string>} namespaces - Normalized namespace root map.
 * @param {Map<string, string[]>} componentGroupRootsCache - Caller-scoped directory cache.
 * @returns {string|null} Existing component template path when found.
 */
export const resolveComponentReference = (
  templatePath,
  namespaces,
  componentGroupRootsCache,
) => {
  const namespaced = parseTwigNamespaceReference(templatePath, namespaces);
  if (namespaced) {
    if (namespaced.namespace !== 'components') return null;

    return (
      findExistingComponentTemplateFile(
        buildTemplateFileCandidates(namespaced.root, namespaced.path),
        namespaced.root,
      ) ||
      resolveGroupedComponentTemplate(
        namespaced.path,
        namespaced.root,
        componentGroupRootsCache,
      )
    );
  }

  return resolveComponentShorthandReference(
    templatePath,
    namespaces?.components,
    componentGroupRootsCache,
  );
};
