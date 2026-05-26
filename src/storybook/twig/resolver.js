/**
 * @file Runtime Twig template resolver used by Storybook Twig helpers.
 */

import { unique } from '../../extensions/shared/lists.js';

const ENV = (typeof __EMULSIFY_ENV__ !== 'undefined' && __EMULSIFY_ENV__) || {};

const twigModules =
  typeof __EMULSIFY_TWIG_GLOB_IMPORTS__ !== 'undefined'
    ? __EMULSIFY_TWIG_GLOB_IMPORTS__
    : {};

const twigSources =
  typeof __EMULSIFY_TWIG_SOURCE_GLOB_IMPORTS__ !== 'undefined'
    ? __EMULSIFY_TWIG_SOURCE_GLOB_IMPORTS__
    : {};

/**
 * Merge Vite glob maps into one lookup object.
 *
 * This function is referenced by source generated in `.storybook/main.js`.
 *
 * @param {Record<string, *>[]} maps - Vite glob maps.
 * @returns {Record<string, *>} Merged map.
 */
export function mergeGlobMaps(maps) {
  return Object.assign({}, ...maps);
}

const normalizeGlobPath = (filePath) => filePath.replace(/\\/g, '/');

/**
 * Convert an absolute project path to a Vite root-relative key.
 *
 * @param {string} absolutePath - Absolute file or directory path.
 * @param {object} env - Normalized Emulsify environment.
 * @returns {string} Root-relative path with a leading slash.
 */
export function toRootRelativePath(absolutePath, env = ENV) {
  if (!absolutePath) return '';

  const normalizedPath = normalizeGlobPath(absolutePath);
  const projectDir = normalizeGlobPath(env?.projectDir || '');

  if (projectDir && normalizedPath.startsWith(projectDir)) {
    const relativePath = normalizedPath.slice(projectDir.length);
    return relativePath.startsWith('/') ? relativePath : `/${relativePath}`;
  }

  return normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`;
}

/**
 * Normalize a Twig root declaration into resolver metadata.
 *
 * @param {{name?: string, directory?: string}|string} root - Root declaration.
 * @param {object} env - Normalized Emulsify environment.
 * @returns {{name: string|undefined, directory: string, rootRel: string}|null}
 */
function normalizeRootRecord(root, env) {
  const directory = typeof root === 'string' ? root : root?.directory;
  if (!directory) return null;

  return {
    name: typeof root === 'string' ? undefined : root.name,
    directory,
    rootRel: toRootRelativePath(directory, env),
  };
}

/**
 * Build Twig roots from the normalized project structure.
 *
 * @param {object} [env=ENV] - Normalized Emulsify environment.
 * @returns {{name: string|undefined, directory: string, rootRel: string}[]}
 *   Twig roots in resolution order.
 */
export function buildTwigRootRecords(env = ENV) {
  const structure = env?.projectStructure || {};
  const namespaceRoots =
    structure.namespaceRoots && typeof structure.namespaceRoots === 'object'
      ? structure.namespaceRoots
      : env?.namespaceRoots && typeof env.namespaceRoots === 'object'
        ? env.namespaceRoots
        : {};
  const namedRoots = [
    ...(Array.isArray(structure.componentRootRecords)
      ? structure.componentRootRecords
      : []),
    ...(Array.isArray(env?.structureImplementations)
      ? env.structureImplementations
      : []),
    ...Object.entries(namespaceRoots).map(([name, directory]) => ({
      name,
      directory,
    })),
  ];
  const unnamedRoots = [
    ...(Array.isArray(structure.twigRoots) ? structure.twigRoots : []),
    ...(Array.isArray(env?.componentRoots) ? env.componentRoots : []),
    ...(env?.srcDir ? [env.srcDir] : []),
  ];
  const fallbackRoots = env?.projectDir
    ? [
        `${env.projectDir}/src`,
        `${env.projectDir}/src/components`,
        `${env.projectDir}/components`,
      ]
    : ['/src', '/src/components', '/components'];
  const records = [...namedRoots, ...unnamedRoots, ...fallbackRoots]
    .map((root) => normalizeRootRecord(root, env))
    .filter(Boolean);

  return unique(
    records.map((record) => `${record.name || ''}|${record.rootRel}`),
  )
    .map((key) =>
      records.find(
        (record) => `${record.name || ''}|${record.rootRel}` === key,
      ),
    )
    .filter(Boolean);
}

/**
 * Remove a Twig file extension from a reference.
 *
 * @param {string} value - Template reference.
 * @returns {string} Reference without `.twig` or `.html.twig`.
 */
function removeTwigExtension(value) {
  return value.replace(/\.html\.twig$/i, '').replace(/\.twig$/i, '');
}

/**
 * Build candidate keys below one root for a template reference.
 *
 * @param {string} rootRel - Root-relative Twig root.
 * @param {string} reference - Template reference relative to the root.
 * @returns {string[]} Candidate Vite glob keys.
 */
export function candidateKeysForRoot(rootRel, reference) {
  const cleanReference = reference.replace(/^[./]+/, '').replace(/^\/+/, '');
  const hasHtmlExtension = /\.html\.twig$/i.test(cleanReference);
  const hasTwigExtension = /\.twig$/i.test(cleanReference);
  const withoutExtension = removeTwigExtension(cleanReference);
  const stem = withoutExtension.split('/').pop();
  const explicitCandidates = hasHtmlExtension
    ? [
        `${rootRel}/${withoutExtension}.html.twig`,
        `${rootRel}/${withoutExtension}.twig`,
      ]
    : [
        `${rootRel}/${withoutExtension}.twig`,
        `${rootRel}/${withoutExtension}.html.twig`,
      ];
  const shorthandCandidates = [
    `${rootRel}/${withoutExtension}/${stem}.twig`,
    `${rootRel}/${withoutExtension}/${stem}.html.twig`,
    ...explicitCandidates,
  ];

  return unique(
    (hasTwigExtension || withoutExtension.includes('/')
      ? explicitCandidates
      : shorthandCandidates
    ).map((key) => key.replace(/\/{2,}/g, '/')),
  );
}

/**
 * Find root records for a namespace.
 *
 * @param {string} namespace - Namespace name.
 * @param {{name?: string}[]} roots - Twig root records.
 * @returns {object[]} Matching root records.
 */
function rootsForNamespace(namespace, roots) {
  return roots.filter((root) => root.name === namespace);
}

/**
 * Parse a Twig template reference into namespace and relative path parts.
 *
 * @param {string} name - Template reference.
 * @returns {{namespace?: string, path: string, shorthand?: boolean}|null}
 */
function parseTemplateReference(name) {
  if (typeof name !== 'string' || !name.trim()) return null;

  const cleanName = name.trim();
  const colonMatch = cleanName.match(/^([^:/.]+):(.+)$/);
  if (colonMatch) {
    return {
      namespace: colonMatch[1],
      path: colonMatch[2],
    };
  }

  const atMatch = cleanName.match(/^@([^/]+)\/(.+)$/);
  if (atMatch) {
    return {
      namespace: atMatch[1],
      path: atMatch[2],
    };
  }

  if (cleanName.startsWith('@')) {
    return {
      path: cleanName.slice(1),
      shorthand: true,
    };
  }

  const slashMatch = cleanName.match(/^([^/]+)\/(.+)$/);
  if (slashMatch) {
    return {
      namespace: slashMatch[1],
      path: slashMatch[2],
    };
  }

  return {
    path: cleanName,
    shorthand: true,
  };
}

/**
 * Build candidate Vite glob keys for a Twig reference.
 *
 * @param {string} name - Template reference.
 * @param {object} env - Normalized Emulsify environment.
 * @returns {string[]} Candidate Vite glob keys.
 */
export function candidateKeysForReference(name, env = ENV) {
  const roots = buildTwigRootRecords(env);
  const parsed = parseTemplateReference(name);
  if (!parsed) return [];

  const projectNamespace = env?.machineName;
  const namespaceRoots =
    parsed.namespace && parsed.namespace !== projectNamespace
      ? rootsForNamespace(parsed.namespace, roots)
      : [];
  const searchRoots = namespaceRoots.length ? namespaceRoots : roots;
  const searchPaths = unique([
    parsed.path,
    ...(parsed.namespace && !namespaceRoots.length
      ? [`${parsed.namespace}/${parsed.path}`]
      : []),
  ]);

  return unique(
    searchRoots.flatMap((root) =>
      searchPaths.flatMap((part) => candidateKeysForRoot(root.rootRel, part)),
    ),
  );
}

/**
 * Resolve a value from a Vite glob map.
 *
 * @param {Record<string, *>} map - Vite glob map.
 * @param {string[]} candidates - Candidate map keys.
 * @returns {*} Resolved map value.
 */
function resolveFromMap(map, candidates) {
  for (const key of candidates) {
    // Vite glob map keys are generated from static Storybook patterns.
    // eslint-disable-next-line security/detect-object-injection
    const value = map[key];
    if (value) {
      return value.default ?? value;
    }
  }

  return undefined;
}

/**
 * Create a Twig resolver bound to a normalized environment and Vite maps.
 *
 * @param {{
 *   env?: object,
 *   modules?: Record<string, *>,
 *   sources?: Record<string, string>
 * }} options - Resolver inputs.
 * @returns {{resolveTemplate: Function, resolveTemplateSource: Function, candidateKeysForReference: Function}}
 *   Resolver functions.
 */
export function createTwigResolver({
  env = ENV,
  modules = twigModules,
  sources = twigSources,
} = {}) {
  return {
    candidateKeysForReference: (name) => candidateKeysForReference(name, env),
    resolveTemplate(name) {
      // Direct lookups support callers that already resolved a Vite glob key.
      // eslint-disable-next-line security/detect-object-injection
      const direct = modules[name];
      if (direct) {
        return direct.default ?? direct;
      }

      const candidates = candidateKeysForReference(name, env);
      const template = resolveFromMap(modules, candidates);
      if (template) {
        return template;
      }

      return undefined;
    },
    resolveTemplateSource(name) {
      // Direct lookups support callers that already resolved a Vite glob key.
      // eslint-disable-next-line security/detect-object-injection
      const direct = sources[name];
      if (typeof direct === 'string') {
        return direct;
      }

      return resolveFromMap(sources, candidateKeysForReference(name, env));
    },
  };
}

const defaultResolver = createTwigResolver();

/**
 * Resolve a template identifier to a compiled Twig render function.
 *
 * @param {string} name - Template identifier.
 * @returns {Function|undefined} Render function when available.
 */
export default function resolveTemplate(name) {
  return defaultResolver.resolveTemplate(name);
}

/**
 * Resolve a template identifier to raw Twig source.
 *
 * @param {string} name - Template identifier.
 * @returns {string|undefined} Raw Twig source when available.
 */
export function resolveTemplateSource(name) {
  return defaultResolver.resolveTemplateSource(name);
}
