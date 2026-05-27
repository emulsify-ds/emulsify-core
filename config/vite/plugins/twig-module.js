/**
 * @file Twig module plugin and Twig namespace option helpers.
 *
 * The plugin turns Twig file imports into render functions for Storybook and
 * Vite consumers while recursively compiling referenced Twig dependencies.
 * It memoizes template compilation and include-path resolution for the active
 * build so shared Twig trees do not repeatedly hit the filesystem. Twig option
 * and namespace lookups are also memoized by environment object identity for
 * one process.
 */

import fs from 'fs';
import { basename, dirname, isAbsolute, relative, resolve } from 'path';
import Twig from 'twig';

import {
  getTwigFunctionMap,
  registerTwigExtensions,
} from '../../../src/extensions/twig/index.js';
import { toRootRelativePath } from '../../../src/storybook/twig/reference-paths.js';
import { resolveProjectStructure } from '../project-structure.js';
import { firstExistingPath, safeExists } from '../utils/fs-safe.js';
import { toPosixPath } from '../utils/paths.js';
import { unique } from '../utils/unique.js';

/** Twig token types that can reference another template file. */
const includeTokenTypes = [
  'Twig.logic.type.embed',
  'Twig.logic.type.extends',
  'Twig.logic.type.from',
  'Twig.logic.type.import',
  'Twig.logic.type.include',
];

/**
 * Cache compiled Twig templates by absolute path for the life of one build.
 *
 * @type {Map<string, { mtimeMs: number, compiled: { code: string, includes: string[], templateId: string, templateParams: object } }>}
 */
const compileCache = new Map();

/**
 * Cache resolved Twig include paths by source directory, reference, and roots.
 *
 * @type {Map<string, string|null>}
 */
const resolutionCache = new Map();

/**
 * Cache Twig namespace maps by environment object identity.
 *
 * @type {WeakMap<object, Record<string, string>>}
 */
let twigNamespacesCache = new WeakMap();

/**
 * Cache Twig plugin options by environment object identity.
 *
 * @type {WeakMap<object, import('@vituum/vite-plugin-twig/types').PluginUserConfig>}
 */
let twigPluginOptionsCache = new WeakMap();

/**
 * Determine whether a value can be used as a WeakMap key.
 *
 * @param {*} env - Candidate environment value.
 * @returns {boolean} TRUE when env is a non-null object.
 */
const isCacheableEnv = (env) => env && typeof env === 'object';

/**
 * Determine whether a Vite request should compile as a Twig render module.
 *
 * @param {string} id - Vite module id, including an optional query string.
 * @returns {boolean} TRUE when the request is a renderable Twig module.
 */
const isTwigModuleRequest = (id) => {
  const [filePath, query = ''] = id.split('?');
  if (!filePath.endsWith('.twig')) return false;
  return !query || query === 'twig' || !/(^|&)(raw|url)\b/.test(query);
};

/**
 * Remove the Vite query string from a module id.
 *
 * @param {string} id - Vite module id.
 * @returns {string} Filesystem path without query parameters.
 */
const stripRequestQuery = (id) => id.split('?')[0];

/**
 * Extract referenced Twig templates from compiled Twig token trees.
 *
 * @param {Array} [tokens=[]] - Twig token tree.
 * @returns {string[]} Referenced template paths.
 */
const pluckIncludes = (tokens = []) => [
  ...tokens
    .filter((token) => includeTokenTypes.includes(token.token?.type))
    .flatMap((token) =>
      (token.token?.stack || [])
        .map((stack) => stack.value)
        .filter((value) => typeof value === 'string'),
    ),
  ...tokens.flatMap((token) => pluckIncludes(token.token?.output || [])),
];

/**
 * Build likely filesystem candidates for a Twig template reference.
 *
 * @param {string} baseDir - Directory used as the resolution root.
 * @param {string} templatePath - Template path from Twig source.
 * @returns {string[]} Candidate absolute paths.
 */
const fileCandidates = (baseDir, templatePath) => {
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
 * Return the first candidate that exists as a file.
 *
 * @param {string[]} paths - Candidate absolute paths.
 * @returns {string|undefined} Existing file path.
 */
const resolveExistingFile = (paths) =>
  paths.filter(Boolean).find((filePath) => {
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      return fs.statSync(filePath).isFile();
    } catch {
      return false;
    }
  });

/**
 * Determine whether a file path is equal to or below a candidate root.
 *
 * @param {string} root - Absolute root path.
 * @param {string} filePath - Absolute file path.
 * @returns {boolean} TRUE when the file belongs to the root.
 */
const isWithinRoot = (root, filePath) => {
  const rootRelativePath = relative(root, filePath);
  return (
    rootRelativePath === '' ||
    (!!rootRelativePath &&
      !rootRelativePath.startsWith('..') &&
      !isAbsolute(rootRelativePath))
  );
};

/**
 * Find the most specific configured Twig root for a template file.
 *
 * @param {string} filePath - Absolute template file path.
 * @param {ReturnType<typeof makeTwigPluginOptions>} options - Twig plugin options.
 * @returns {string} Absolute Twig root path.
 */
const templateRootForPath = (filePath, options) => {
  const roots = unique(
    [options.root, ...Object.values(options.namespaces || {})]
      .filter(Boolean)
      .map((root) => resolve(root)),
  ).sort((left, right) => right.length - left.length);

  return (
    roots.find((root) => isWithinRoot(root, filePath)) ||
    options.root ||
    dirname(filePath)
  );
};

/**
 * Build a stable Twig template id from the configured root and relative path.
 *
 * @param {string} filePath - Absolute template file path.
 * @param {ReturnType<typeof makeTwigPluginOptions>} options - Twig plugin options.
 * @returns {string} Stable Twig template id.
 */
const templateIdForPath = (filePath, options) => {
  const templateRoot = templateRootForPath(filePath, options);
  const rootRel = toRootRelativePath(templateRoot, options);
  const relPath = toPosixPath(relative(templateRoot, filePath));

  return `${rootRel}::${relPath}`;
};

/**
 * Build a generated-module expression that reuses cached Twig templates.
 *
 * @param {string} templateId - Stable Twig template id.
 * @param {object} params - Twig template parameters without the id.
 * @returns {string} Cache-aware compiled template expression.
 */
const runtimeTemplateCode = (templateId, params) =>
  `__emulsifyTwigTemplate(${JSON.stringify(templateId)}, ${JSON.stringify(
    params,
  )})`;

/**
 * Match the template id Twig.js will request for an inline include.
 *
 * @param {string} templatePath - Template reference from Twig source.
 * @param {string} fromFilePath - Absolute path of the importing template.
 * @param {ReturnType<typeof makeTwigPluginOptions>} options - Twig plugin options.
 * @returns {string} Runtime lookup id used by Twig.js.
 */
const runtimeIncludeAlias = (templatePath, fromFilePath, options) =>
  Twig.path.parsePath(
    { path: fromFilePath, options: { namespaces: options.namespaces } },
    templatePath,
  );

/**
 * Resolve Twig namespace syntax to a namespace root and relative path.
 *
 * @param {string} templatePath - Template reference from Twig source.
 * @param {Record<string, string>} [namespaces={}] - Namespace root map.
 * @returns {{ root: string, path: string }|null} Namespace lookup result.
 */
const namespaceReference = (templatePath, namespaces = {}) => {
  const namespaceNames = Object.keys(namespaces);
  const atNamespace = templatePath.match(/^@([^/]+)\/(.+)$/);
  if (atNamespace && namespaces[atNamespace[1]]) {
    return { root: namespaces[atNamespace[1]], path: atNamespace[2] };
  }

  const doubleColon = templatePath.match(/^([^:]+)::(.+)$/);
  if (doubleColon && namespaces[doubleColon[1]]) {
    return { root: namespaces[doubleColon[1]], path: doubleColon[2] };
  }

  const singleColon = templatePath.match(/^([^:/.]+):(.+)$/);
  if (singleColon && namespaces[singleColon[1]]) {
    return { root: namespaces[singleColon[1]], path: singleColon[2] };
  }

  const slashNamespace = namespaceNames.find((namespace) =>
    templatePath.startsWith(`${namespace}/`),
  );
  if (slashNamespace) {
    return {
      root: namespaces[slashNamespace],
      path: templatePath.slice(slashNamespace.length + 1),
    };
  }

  return null;
};

/**
 * Resolve shorthand component references against the components namespace.
 *
 * @param {string} templatePath - Template reference from Twig source.
 * @param {string} componentRoot - Absolute component root path.
 * @returns {string|null} Existing template path when found.
 */
const resolveComponentNamespaceFallback = (templatePath, componentRoot) => {
  if (!componentRoot || templatePath.startsWith('.')) return null;

  const shorthandPath =
    templatePath.startsWith('@') && !templatePath.includes('/')
      ? templatePath.slice(1)
      : templatePath;
  const directComponentPath = resolveExistingFile(
    fileCandidates(componentRoot, shorthandPath),
  );
  if (directComponentPath) {
    return directComponentPath;
  }

  const genericNamespace = templatePath.match(/^@?[^/:]+[:/](.+)$/);
  if (!genericNamespace) {
    return null;
  }

  return resolveExistingFile(
    fileCandidates(componentRoot, genericNamespace[1]),
  );
};

/**
 * Build a stable key segment for include resolution cache entries.
 *
 * @param {ReturnType<typeof makeTwigPluginOptions>} options - Twig plugin options.
 * @returns {string} Stable root and namespace cache key.
 */
const twigResolutionRootKey = (options) => {
  const namespaceKey = Object.entries(options.namespaces || {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([namespace, root]) => `${namespace}=${root}`)
    .join(',');

  return `${options.root || ''}|${namespaceKey}`;
};

/**
 * Resolve a Twig include/import/extends reference from a source directory.
 *
 * @param {string} templatePath - Template reference from Twig source.
 * @param {string} fromDir - Directory of the importing template.
 * @param {{ root: string, namespaces: Record<string, string> }} options - Twig plugin options.
 * @returns {string|null} Existing template path when found.
 */
const resolveTwigTemplateUncached = (templatePath, fromDir, options) => {
  if (templatePath === '_self') return null;

  const namespaced = namespaceReference(templatePath, options.namespaces);
  if (namespaced) {
    return resolveExistingFile(
      fileCandidates(namespaced.root, namespaced.path),
    );
  }

  const relativeTemplate = resolveExistingFile([
    ...fileCandidates(fromDir, templatePath),
    ...fileCandidates(options.root, templatePath),
  ]);

  return (
    relativeTemplate ||
    resolveComponentNamespaceFallback(
      templatePath,
      options.namespaces?.components,
    )
  );
};

/**
 * Resolve a Twig reference with build-scoped filesystem probe memoization.
 *
 * @param {string} templatePath - Template reference from Twig source.
 * @param {string} fromDir - Directory of the importing template.
 * @param {ReturnType<typeof makeTwigPluginOptions>} options - Twig plugin options.
 * @returns {string|null} Existing template path when found.
 */
const resolveTwigTemplate = (templatePath, fromDir, options) => {
  const cacheKey = [
    resolve(fromDir),
    templatePath,
    twigResolutionRootKey(options),
  ].join('|');

  if (resolutionCache.has(cacheKey)) {
    return resolutionCache.get(cacheKey);
  }

  const resolvedPath =
    resolveTwigTemplateUncached(templatePath, fromDir, options) || null;
  resolutionCache.set(cacheKey, resolvedPath);
  return resolvedPath;
};

/**
 * Compile a Twig template and collect its nested template references.
 *
 * @param {string} filePath - Absolute template file path.
 * @param {ReturnType<typeof makeTwigPluginOptions>} options - Twig plugin options.
 * @param {typeof compileCache} [cache=compileCache] - Shared compile cache.
 * @returns {{ code: string, includes: string[] }} Compiled template code and references.
 */
const compileTwigTemplate = (filePath, options, cache = compileCache) => {
  const absoluteFilePath = resolve(filePath);
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const { mtimeMs } = fs.statSync(absoluteFilePath);
  const cached = cache.get(absoluteFilePath);
  if (cached?.mtimeMs === mtimeMs) {
    return cached.compiled;
  }

  const compilerTwig = Twig.factory();
  registerTwigExtensions(compilerTwig);

  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const source = fs.readFileSync(absoluteFilePath, 'utf8');
  const compileOptions = {
    allowInlineIncludes: true,
    namespaces: options.namespaces,
    rethrow: true,
    ...(options.options?.compileOptions || {}),
  };
  const templateId = templateIdForPath(absoluteFilePath, options);
  const template = compilerTwig.twig({
    ...compileOptions,
    data: source,
    id: templateId,
    path: absoluteFilePath,
  });
  const includes = unique(pluckIncludes(template.tokens).filter(Boolean));
  const templateParams = {
    __emulsifyTwigSignature: `${absoluteFilePath}:${mtimeMs}`,
    allowInlineIncludes: true,
    data: template.tokens,
    namespaces: options.namespaces,
    path: absoluteFilePath,
    precompiled: true,
    rethrow: true,
  };
  const compiled = {
    code: runtimeTemplateCode(templateId, templateParams),
    includes,
    templateId,
    templateParams,
  };

  cache.set(absoluteFilePath, { mtimeMs, compiled });
  return compiled;
};

/**
 * Build platform-neutral Twig namespaces for the resolved project structure.
 *
 * @param {{
 *   projectDir: string,
 *   srcDir: string,
 *   srcExists: boolean,
 *   structureOverrides?: boolean,
 *   structureRoots?: string[]
 * }} env
 * @returns {Record<string, string>}
 */
export function makeTwigNamespaces(env) {
  if (isCacheableEnv(env) && twigNamespacesCache.has(env)) {
    return twigNamespacesCache.get(env);
  }

  const structure = env.projectStructure || resolveProjectStructure(env);
  let namespaces;
  if (
    structure.namespaceRoots &&
    typeof structure.namespaceRoots === 'object'
  ) {
    namespaces = { ...structure.namespaceRoots };
  } else {
    const {
      projectDir,
      srcDir,
      srcExists,
      structureOverrides,
      structureRoots = [],
    } = env;

    namespaces = {};
    const overrideRoots = structureOverrides ? structureRoots : [];
    const componentRoot =
      basename(srcDir) === 'components'
        ? srcDir
        : resolve(srcDir, 'components');
    const componentsNamespace = firstExistingPath([
      ...new Set([
        ...overrideRoots,
        componentRoot,
        resolve(projectDir, 'src/components'),
        resolve(projectDir, 'components'),
      ]),
    ]);
    const layoutNamespace = firstExistingPath([
      ...new Set([
        ...(srcExists ? [resolve(srcDir, 'layout')] : []),
        resolve(projectDir, 'src/layout'),
        resolve(projectDir, 'layout'),
      ]),
    ]);
    const tokensNamespace = firstExistingPath([
      ...new Set([
        ...(srcExists ? [resolve(srcDir, 'tokens')] : []),
        resolve(projectDir, 'src/tokens'),
        resolve(projectDir, 'tokens'),
      ]),
    ]);

    if (componentsNamespace) {
      namespaces.components = componentsNamespace;
    }
    if (layoutNamespace) {
      namespaces.layout = layoutNamespace;
    }
    if (tokensNamespace) {
      namespaces.tokens = tokensNamespace;
    }
  }

  if (isCacheableEnv(env)) {
    twigNamespacesCache.set(env, namespaces);
  }

  return namespaces;
}

/**
 * Build the generic Twig plugin options shared by Vite and Storybook.
 *
 * @param {{
 *   projectDir: string,
 *   srcDir: string,
 *   structureOverrides?: boolean,
 *   structureRoots?: string[]
 * }} env
 * @returns {import('@vituum/vite-plugin-twig/types').PluginUserConfig}
 */
export function makeTwigPluginOptions(env) {
  if (isCacheableEnv(env) && twigPluginOptionsCache.has(env)) {
    return twigPluginOptionsCache.get(env);
  }

  const { projectDir, srcDir, structureOverrides, structureRoots = [] } = env;
  const structure = env.projectStructure || resolveProjectStructure(env);
  const overrideRoots = structureOverrides ? structureRoots : [];
  const root = firstExistingPath(
    structure.twigRoots?.length
      ? [...structure.twigRoots, srcDir, projectDir]
      : structureOverrides
        ? [...overrideRoots, srcDir, projectDir]
        : [srcDir, ...overrideRoots, projectDir],
  );

  const twigOptions = {
    root: root || srcDir || projectDir,
    namespaces: makeTwigNamespaces(env),
    functions: getTwigFunctionMap(),
    reload: (filePath) => /\.(twig|json)$/i.test(filePath),
  };

  Object.defineProperty(twigOptions, 'projectDir', {
    value: projectDir,
  });

  if (isCacheableEnv(env)) {
    twigPluginOptionsCache.set(env, twigOptions);
  }

  return twigOptions;
}

/**
 * Clear process-local Twig namespace and plugin option memoization caches.
 *
 * @returns {void}
 */
export function resetTwigOptionCaches() {
  twigNamespacesCache = new WeakMap();
  twigPluginOptionsCache = new WeakMap();
}

/**
 * Transform Twig imports into render functions for Storybook and Vite consumers.
 *
 * @param {ReturnType<typeof makeTwigPluginOptions>} options - Twig options.
 * @returns {import('vite').PluginOption} Twig module plugin.
 */
export function emulsifyTwigModulePlugin(options) {
  const dependencyImporters = new Map();
  const addDependencyImporter = (dependency, importer) => {
    const importers = dependencyImporters.get(dependency) || new Set();
    importers.add(importer);
    dependencyImporters.set(dependency, importers);
  };
  const clearDependencyImporter = (importer) => {
    for (const [dependency, importers] of dependencyImporters) {
      importers.delete(importer);
      if (!importers.size) {
        dependencyImporters.delete(dependency);
      }
    }
  };

  return {
    name: 'emulsify-twig-module',
    enforce: 'pre',
    buildStart() {
      compileCache.clear();
      resolutionCache.clear();
    },
    transform(...args) {
      const [, id] = args;
      if (!isTwigModuleRequest(id)) {
        return null;
      }

      const filePath = stripRequestQuery(id);
      const compiledIncludes = new Map();
      clearDependencyImporter(filePath);

      const compileIncludes = (includes, fromFilePath, cache) => {
        for (const templatePath of includes) {
          const includePath = resolveTwigTemplate(
            templatePath,
            dirname(fromFilePath),
            options,
          );
          if (!includePath) continue;

          const aliases = unique([
            includePath,
            runtimeIncludeAlias(templatePath, fromFilePath, options),
          ]);
          const entry = compiledIncludes.get(includePath);
          if (entry) {
            for (const alias of aliases) {
              entry.aliases.add(alias);
            }
            continue;
          }

          addDependencyImporter(includePath, filePath);
          this.addWatchFile(includePath);

          const compiled = compileTwigTemplate(includePath, options, cache);
          compiledIncludes.set(includePath, {
            aliases: new Set(aliases),
            compiled,
          });
          compileIncludes(compiled.includes, includePath, cache);
        }
      };

      try {
        const compiled = compileTwigTemplate(filePath, options, compileCache);
        compileIncludes(compiled.includes, filePath, compileCache);

        const includeCode = Array.from(compiledIncludes.values())
          .reverse()
          .flatMap(({ aliases, compiled: include }) =>
            unique([include.templateId, ...aliases]).map(
              (templateId) =>
                `${runtimeTemplateCode(templateId, include.templateParams)};`,
            ),
          )
          .join('\n');
        const renderErrorPrefix = JSON.stringify(
          `An error occurred whilst rendering ${toPosixPath(filePath)}: `,
        );
        const moduleCode = `
          import Twig from 'twig';
          import { registerTwigExtensions } from '@emulsify/core/extensions/twig';

          const { twig } = Twig;
          const __emulsifyTwigDeleteTemplate = (id) => {
            if (typeof Twig.extend !== 'function') return;

            Twig.extend((TwigCore) => {
              if (TwigCore?.Templates?.registry) {
                delete TwigCore.Templates.registry[id];
              }
            });
          };
          const __emulsifyTwigTemplate = (id, params) => {
            const cached = Twig.twig({ ref: id });
            const signature = params.__emulsifyTwigSignature;

            if (cached) {
              cached.options = {
                ...(cached.options || {}),
                allowInlineIncludes: true,
                namespaces: params.namespaces,
                rethrow: true,
              };

              if (!signature || cached.__emulsifyTwigSignature === signature) {
                return cached;
              }

              // Twig.twig({ ref }) bypasses Twig.cache and can return stale HMR entries.
              __emulsifyTwigDeleteTemplate(id);
            }

            const template = twig({ ...params, id });
            template.__emulsifyTwigSignature = signature;
            return template;
          };

          registerTwigExtensions(Twig);

          ${includeCode}

          export default (context = {}) => {
            try {
              const template = ${compiled.code};
              template.options.allowInlineIncludes = true;
              return template.render(context);
            } catch (error) {
              return ${renderErrorPrefix} + error.toString();
            }
          };
        `;

        return {
          code: moduleCode,
          map: null,
        };
      } catch (error) {
        const message = `An error occurred whilst compiling ${toPosixPath(
          filePath,
        )}: ${error.toString()}`;

        return {
          code: `export default () => ${JSON.stringify(message)};`,
          map: null,
        };
      }
    },
    handleHotUpdate({ file, server }) {
      if (!file.endsWith('.twig')) {
        return undefined;
      }

      const filePath = resolve(file);
      compileCache.delete(filePath);
      const importers = dependencyImporters.get(filePath);
      if (!safeExists(filePath)) {
        dependencyImporters.delete(filePath);
      }

      const projectRoot = options.projectDir || options.root;
      if (projectRoot && isWithinRoot(resolve(projectRoot), filePath)) {
        resolutionCache.clear();
      }

      if (!importers?.size) {
        return undefined;
      }

      const modules = new Set(
        server.moduleGraph.getModulesByFile(filePath) || [],
      );
      for (const importer of importers) {
        compileCache.delete(importer);

        const importerModules =
          server.moduleGraph.getModulesByFile(importer) || [];

        for (const module of importerModules) {
          server.moduleGraph.invalidateModule(module);
          modules.add(module);
        }
      }

      return Array.from(modules);
    },
  };
}
