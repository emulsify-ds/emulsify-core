/**
 * @file Twig module plugin and Twig namespace option helpers.
 *
 * The plugin turns Twig file imports into render functions for Storybook and
 * Vite consumers while recursively compiling referenced Twig dependencies.
 */

import { readFileSync, statSync } from 'fs';
import { basename, dirname, resolve } from 'path';
import Twig from 'twig';

import {
  getTwigFunctionMap,
  registerTwigExtensions,
} from '../../../src/extensions/twig/index.js';
import { resolveProjectStructure } from '../project-structure.js';
import { firstExistingPath } from '../utils/fs-safe.js';
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
      return statSync(filePath).isFile();
    } catch {
      return false;
    }
  });

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
 * Resolve a Twig include/import/extends reference from a source directory.
 *
 * @param {string} templatePath - Template reference from Twig source.
 * @param {string} fromDir - Directory of the importing template.
 * @param {{ root: string, namespaces: Record<string, string> }} options - Twig plugin options.
 * @returns {string|null} Existing template path when found.
 */
const resolveTwigTemplate = (templatePath, fromDir, options) => {
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
 * Compile a Twig template and collect its nested template references.
 *
 * @param {string} templateId - Twig template id.
 * @param {string} filePath - Absolute template file path.
 * @param {ReturnType<typeof makeTwigPluginOptions>} options - Twig plugin options.
 * @returns {{ code: string, includes: string[] }} Compiled template code and references.
 */
const compileTwigTemplate = (templateId, filePath, options) => {
  registerTwigExtensions(Twig);

  // Vite/Storybook can transform the same Twig module more than once during
  // startup or HMR. Disable Twig.js' global duplicate-id guard while parsing.
  Twig.cache(false);

  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const source = readFileSync(filePath, 'utf8');
  const compileOptions = {
    allowInlineIncludes: true,
    namespaces: options.namespaces,
    rethrow: true,
    ...(options.options?.compileOptions || {}),
  };
  const template = Twig.twig({
    ...compileOptions,
    data: source,
    id: templateId,
    path: filePath,
  });
  const includes = unique(pluckIncludes(template.tokens).filter(Boolean));

  return {
    code: template.compile(compileOptions),
    includes,
  };
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
  const structure = env.projectStructure || resolveProjectStructure(env);
  if (
    structure.namespaceRoots &&
    typeof structure.namespaceRoots === 'object'
  ) {
    return { ...structure.namespaceRoots };
  }

  const {
    projectDir,
    srcDir,
    srcExists,
    structureOverrides,
    structureRoots = [],
  } = env;

  const namespaces = {};
  const overrideRoots = structureOverrides ? structureRoots : [];
  const componentRoot =
    basename(srcDir) === 'components' ? srcDir : resolve(srcDir, 'components');
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

  return {
    root: root || srcDir || projectDir,
    namespaces: makeTwigNamespaces(env),
    functions: getTwigFunctionMap(),
    reload: (filePath) => /\.(twig|json)$/i.test(filePath),
  };
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
    for (const importers of dependencyImporters.values()) {
      importers.delete(importer);
    }
  };

  return {
    name: 'emulsify-twig-module',
    enforce: 'pre',
    transform(...args) {
      const [, id] = args;
      if (!isTwigModuleRequest(id)) {
        return null;
      }

      const filePath = stripRequestQuery(id);
      const compiledIncludes = new Map();
      clearDependencyImporter(filePath);

      const compileIncludes = (includes, fromDir) => {
        for (const templatePath of includes) {
          const includePath = resolveTwigTemplate(
            templatePath,
            fromDir,
            options,
          );
          if (!includePath || compiledIncludes.has(includePath)) continue;

          addDependencyImporter(includePath, filePath);
          this.addWatchFile(includePath);

          const compiled = compileTwigTemplate(
            templatePath,
            includePath,
            options,
          );
          compiledIncludes.set(includePath, compiled);
          compileIncludes(compiled.includes, dirname(includePath));
        }
      };

      try {
        const compiled = compileTwigTemplate(filePath, filePath, options);
        compileIncludes(compiled.includes, dirname(filePath));

        const includeCode = Array.from(compiledIncludes.values())
          .reverse()
          .map((include) => `${include.code};`)
          .join('\n');
        const renderErrorPrefix = JSON.stringify(
          `An error occurred whilst rendering ${toPosixPath(filePath)}: `,
        );
        const moduleCode = `
          import Twig from 'twig';
          import { registerTwigExtensions } from '@emulsify/core/extensions/twig';

          const { twig } = Twig;

          registerTwigExtensions(Twig);
          Twig.cache(false);

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

      const importers = dependencyImporters.get(file);
      if (!importers?.size) {
        return undefined;
      }

      const modules = new Set(server.moduleGraph.getModulesByFile(file) || []);
      for (const importer of importers) {
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
