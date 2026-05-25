/**
 * @file Vite plugins factory for Emulsify.
 *
 * This module assembles the shared plugin chain used by Vite and Storybook.
 * It copies Twig templates, component metadata, and non-code assets with the
 * same routing rules as JS/CSS:
 *   - `src/components/**`         -> `dist/components/**`
 *   - `components/**`             -> `dist/components/**`
 *   - `src/!(components|util)/**` -> `dist/global/**`
 *   - structure implementation roots -> `dist/<implementation-name>/**`
 *
 * It also builds a physical SVG spritemap at `dist/assets/icons.svg`.
 */

import {
  resolve,
  join,
  dirname,
  basename,
  relative,
  sep,
  posix as pathPosix,
} from 'path';
import {
  mkdirSync,
  copyFileSync,
  unlinkSync,
  readdirSync,
  rmdirSync,
  statSync,
  existsSync,
  readFileSync,
} from 'fs';
import { globSync } from 'glob';
import sassGlobImports from 'vite-plugin-sass-glob-import';
import yml from '@modyfi/vite-plugin-yaml';
import twig from '@vituum/vite-plugin-twig';
import Twig from 'twig';
import {
  getTwigFunctionMap,
  registerTwigExtensions,
} from '../../src/extensions/twig/index.js';
import { getPlatformAdapter } from './platforms.js';
import {
  copiedComponentOutputPath,
  copiedGlobalOutputPath,
  findSourceRoot,
  relativeFrom,
  resolveProjectStructure,
} from './project-structure.js';

/* ============================================================================
 * Small, focused helpers
 * ========================================================================== */

/** Determine whether a Twig file is a partial (filename starts with `_`). */
const isPartial = (filePath) =>
  (filePath.split('/')?.pop() || '').trim().startsWith('_');

/**
 * Return the first existing path in a list.
 * @param {string[]} paths
 * @returns {string|undefined}
 */
const firstExistingPath = (paths) =>
  paths.filter(Boolean).find((filePath) => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    return existsSync(filePath);
  });

/** Normalize Windows separators before paths are used in globs or output keys. */
const toPosixPath = (filePath) => filePath.replace(/\\/g, '/');

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
 * Return truthy values in first-seen order with duplicates removed.
 *
 * @param {*[]} items - Candidate values.
 * @returns {*[]} Unique truthy values.
 */
const unique = (items) => [...new Set(items.filter(Boolean))];

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

  return unique([
    resolve(baseDir, normalizedTemplatePath),
    resolve(baseDir, `${normalizedTemplatePath}.twig`),
    resolve(baseDir, `${normalizedTemplatePath}.html.twig`),
    resolve(baseDir, withoutTwigExt, `${stem}.twig`),
    resolve(baseDir, withoutTwigExt, `${stem}.html.twig`),
  ]);
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
  const includes = unique(pluckIncludes(template.tokens));

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
 * Instantiate Vituum's Twig renderer without its entry-renaming build hooks.
 *
 * Emulsify builds use an object-shaped Rollup input map for deterministic
 * JS/CSS output paths. Vituum's rename/bundle helpers expect array inputs and
 * only apply when Twig files are Rollup entries, so keep the Twig rendering,
 * middleware, and reload behavior without those incompatible hooks.
 *
 * @param {Parameters<typeof makeTwigPluginOptions>[0]} env
 * @returns {import('vite').PluginOption[]}
 */
function makeTwigPlugins(env, options = makeTwigPluginOptions(env)) {
  registerTwigExtensions(Twig);

  const twigPlugins = twig(options);
  return (Array.isArray(twigPlugins) ? twigPlugins : [twigPlugins])
    .filter(
      (pluginOption) =>
        pluginOption?.name !== '@vituum/vite-plugin-core:bundle',
    )
    .map((pluginOption) => {
      if (pluginOption?.name !== '@vituum/vite-plugin-twig') {
        return pluginOption;
      }

      const renderPlugin = { ...pluginOption };
      delete renderPlugin.buildStart;
      delete renderPlugin.buildEnd;
      return renderPlugin;
    });
}

/**
 * Transform Twig imports into render functions for Storybook and Vite consumers.
 *
 * Vituum renders Twig page entries to HTML, but Emulsify stories import Twig
 * component files as JavaScript modules. This keeps that component-module
 * contract platform-neutral after removing the Drupal-specific Twig plugin.
 *
 * @param {ReturnType<typeof makeTwigPluginOptions>} options
 * @returns {import('vite').PluginOption}
 */
function emulsifyTwigModulePlugin(options) {
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

/**
 * Depth-first walk to list every file under a given root.
 *
 * @param {string} rootDir
 * @param {{ shouldSkipDir?: (dir: string) => boolean }} [options]
 * @returns {string[]}
 */
const walkFiles = (rootDir, { shouldSkipDir = () => false } = {}) => {
  const files = [];
  const stack = [rootDir];

  while (stack.length) {
    const currentDir = stack.pop();
    if (!currentDir) continue;

    let entryNames = [];
    try {
      entryNames = readdirSync(currentDir).sort();
    } catch {
      // Skip unreadable directories and keep walking the remaining stack.
      continue;
    }

    for (const name of entryNames) {
      const fullPath = join(currentDir, name);
      try {
        const stats = statSync(fullPath);
        if (stats.isDirectory()) {
          if (!shouldSkipDir(fullPath)) stack.push(fullPath);
        } else files.push(fullPath);
      } catch {
        // Ignore unreadable entries so one file does not stop the copy pass.
      }
    }
  }
  return files;
};

/**
 * Determine whether a directory is the same as, or nested inside, another one.
 *
 * @param {string} candidateDir
 * @param {string} rootDir
 * @returns {boolean}
 */
const isSameOrInsideDir = (candidateDir, rootDir) => {
  const rel = relative(rootDir, candidateDir);
  return !rel || (!rel.startsWith('..') && !rel.includes(`..${sep}`));
};

/**
 * Determine whether a file is component metadata copied beside Twig templates.
 *
 * @param {string} filePath
 * @returns {boolean}
 */
const isComponentMetadataFile = (filePath) =>
  /\.component\.(yml|yaml|json)$/.test(filePath);

/**
 * Determine whether a file should be copied by the static asset pass.
 *
 * @param {string} filePath
 * @returns {boolean}
 */
const isStaticSourceAsset = (filePath) =>
  !/\.(js|scss|twig|map)$/.test(filePath) && !isComponentMetadataFile(filePath);

/**
 * Build the roots that should not be crawled during a global source pass.
 *
 * @param {{ directory: string }} globalRoot
 * @param {{ directory: string }[]} componentRoots
 * @returns {string[]}
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
 *
 * Copy plugins use this index so Twig, component metadata, and static assets
 * filter the same file list instead of running separate glob passes over the
 * same directories.
 *
 * @param {object} structure
 * @returns {{
 *   all: () => Array<object>,
 *   componentFiles: () => Array<object>,
 *   globalFiles: () => Array<object>
 * }}
 */
function createSourceFileIndex(structure) {
  let indexedFiles = null;

  const indexRoot = (root, rootType, options = {}) =>
    walkFiles(root.directory, options).map((absPath) => ({
      absPath,
      relPath: relativeFrom(absPath, root.directory),
      root,
      rootType,
    }));

  const build = () => {
    if (indexedFiles) return indexedFiles;

    const componentFiles = structure.componentRootRecords.flatMap((root) =>
      indexRoot(root, 'component'),
    );
    const globalFiles = structure.globalRootRecords.flatMap((root) => {
      const skipRoots = globalTraversalSkipRoots(
        root,
        structure.componentRootRecords,
      );

      return indexRoot(root, 'global', {
        shouldSkipDir: (directory) =>
          skipRoots.some((skipRoot) => isSameOrInsideDir(directory, skipRoot)),
      });
    });

    indexedFiles = [...componentFiles, ...globalFiles];
    return indexedFiles;
  };

  return {
    all: build,
    componentFiles: () =>
      build().filter((entry) => entry.rootType === 'component'),
    globalFiles: () => build().filter((entry) => entry.rootType === 'global'),
  };
}

/**
 * Remove empty parent directories from a start directory up to, but not including,
 * a stopping boundary directory.
 *
 * @param {string} startDir
 * @param {string} stopAtDir
 */
const pruneEmptyDirsUpTo = (startDir, stopAtDir) => {
  const stopAbs = resolve(stopAtDir);
  let cursor = resolve(startDir);

  const isEmpty = (dir) => {
    try {
      return readdirSync(dir).length === 0;
    } catch {
      return false;
    }
  };

  while (cursor.startsWith(stopAbs)) {
    if (!isEmpty(cursor)) break;

    try {
      rmdirSync(cursor);
    } catch {
      // Stop at the first directory that cannot be removed.
      break;
    }

    const parent = dirname(cursor);
    if (parent === cursor || parent === stopAbs) break;
    cursor = parent;
  }
};

/**
 * Determine whether two files already contain the same bytes.
 *
 * Drupal SDC mirroring can avoid rewriting unchanged root component files, but
 * it must not skip a changed same-size file. Compare size first, then bytes only
 * when the cheap stat check says a match is possible.
 *
 * @param {string} sourceFile
 * @param {string} destinationFile
 * @returns {boolean}
 */
const filesHaveSameBytes = (sourceFile, destinationFile) => {
  try {
    const sourceStats = statSync(sourceFile);
    const destinationStats = statSync(destinationFile);
    if (!destinationStats.isFile()) return false;
    if (sourceStats.size !== destinationStats.size) return false;
    if (sourceStats.size === 0) return true;

    return readFileSync(sourceFile).equals(readFileSync(destinationFile));
  } catch {
    return false;
  }
};

/* ============================================================================
 * Plugin: Copy Twig files (+ component metadata) using JS/CSS-like routing
 * ========================================================================== */

/**
 * Copy Twig templates and component metadata to `dist/`,
 * respecting the same routing used for JS/CSS.
 *
 * @param {{ structure: object, sourceFileIndex?: object }} opts
 * @returns {import('vite').PluginOption}
 */
function copyTwigFilesPlugin({
  structure,
  sourceFileIndex = createSourceFileIndex(structure),
}) {
  let outDir = 'dist';

  const copyToOutDir = (absPath, relDest) => {
    if (!relDest) return;
    const destPath = join(outDir, relDest);
    mkdirSync(dirname(destPath), { recursive: true });
    try {
      copyFileSync(absPath, destPath);
    } catch {
      /* noop */
    }
  };

  return {
    name: 'emulsify-copy-twig-files',
    apply: 'build',
    enforce: 'post',

    /** Capture the final outDir. */
    configResolved(cfg) {
      outDir = cfg.build?.outDir || 'dist';
    },

    /** Perform the copying after the bundle has been written. */
    closeBundle() {
      for (const file of sourceFileIndex.componentFiles()) {
        if (file.absPath.endsWith('.twig')) {
          if (isPartial(file.relPath)) continue;
          copyToOutDir(
            file.absPath,
            copiedComponentOutputPath(file.absPath, structure),
          );
        } else if (isComponentMetadataFile(file.absPath)) {
          copyToOutDir(
            file.absPath,
            copiedComponentOutputPath(file.absPath, structure),
          );
        }
      }

      for (const file of sourceFileIndex.globalFiles()) {
        if (!file.absPath.endsWith('.twig')) continue;
        if (isPartial(file.relPath)) continue;
        copyToOutDir(
          file.absPath,
          copiedGlobalOutputPath(file.absPath, structure),
        );
      }
    },
  };
}

/* ============================================================================
 * Plugin: Copy all non-code assets under `src/` with the same routing
 * ========================================================================== */

/**
 * Copies anything in resolved source roots that is not a code/template file into
 * either `dist/components/**` or `dist/global/**`, preserving relative paths.
 *
 * Excludes: .js, .scss, .twig, source maps, and `*.component.(yml|yaml|json)`.
 *
 * @param {{ structure: object, sourceFileIndex?: object }} opts
 * @returns {import('vite').PluginOption}
 */
function copyAllSrcAssetsPlugin({
  structure,
  sourceFileIndex = createSourceFileIndex(structure),
}) {
  let outDir = 'dist';

  const copyToOutDir = (absPath, relDest) => {
    if (!relDest) return;
    const destPath = join(outDir, relDest);
    mkdirSync(dirname(destPath), { recursive: true });
    try {
      copyFileSync(absPath, destPath);
    } catch {
      /* noop */
    }
  };

  return {
    name: 'emulsify-copy-all-src-assets',
    apply: 'build',
    enforce: 'post',

    /** Capture outDir. */
    configResolved(cfg) {
      outDir = cfg.build?.outDir || 'dist';
    },

    /** Copy component/global assets. */
    closeBundle() {
      for (const file of sourceFileIndex.componentFiles()) {
        if (!isStaticSourceAsset(file.absPath)) continue;
        copyToOutDir(
          file.absPath,
          copiedComponentOutputPath(file.absPath, structure),
        );
      }

      for (const file of sourceFileIndex.globalFiles()) {
        if (!isStaticSourceAsset(file.absPath)) continue;
        if (findSourceRoot(file.absPath, structure.componentRootRecords)) {
          continue;
        }
        copyToOutDir(
          file.absPath,
          copiedGlobalOutputPath(file.absPath, structure),
        );
      }
    },
  };
}

/* ============================================================================
 * Plugin: Build a physical SVG spritemap at dist/assets/icons.svg
 * ========================================================================== */

/**
 * Builds a single SVG sprite file from a set of icon globs and emits it as
 * `assets/icons.svg`. Only the options used by Emulsify are supported.
 *
 * @param {{ include: string|string[], symbolId?: string }} options
 * @returns {import('vite').PluginOption}
 */
function svgSpriteFilePlugin({ include, symbolId = '[name]' }) {
  const toArray = (x) => (Array.isArray(x) ? x : [x]).filter(Boolean);
  const posix = (p) => p.replace(/\\/g, '/');

  /** @type {string[]} */
  let patterns = [];
  /** @type {string[]} */
  let iconFiles = [];
  let iconFilesResolved = false;

  const collectIconFiles = () => {
    if (iconFilesResolved) return iconFiles;
    iconFiles = unique(patterns.flatMap((p) => globSync(p))).sort((a, b) =>
      posix(a).localeCompare(posix(b)),
    );
    iconFilesResolved = true;
    return iconFiles;
  };

  return {
    name: 'emulsify-svg-sprite-file',
    apply: 'build',

    /** Register icons for watch. */
    buildStart() {
      patterns = toArray(include).map(posix);
      iconFilesResolved = false;
      for (const f of collectIconFiles()) {
        try {
          this.addWatchFile(f);
        } catch {
          /* noop */
        }
      }
    },

    /** Concatenate all matched SVGs into a single sprite. */
    generateBundle() {
      const files = collectIconFiles();

      if (!files.length) return;

      const used = new Set();
      const makeId = (abs) => {
        const stem = basename(abs).replace(/\.svg$/i, '');
        let id = symbolId
          .replace('[name]', stem)
          .toLowerCase()
          .replace(/[^a-z0-9_-]+/g, '-')
          .replace(/^-+|-+$/g, '');
        if (!used.has(id)) {
          used.add(id);
          return id;
        }
        let i = 2;
        while (used.has(`${id}-${i}`)) i += 1;
        id = `${id}-${i}`;
        used.add(id);
        return id;
      };

      const symbols = files
        .map((abs) => {
          let content = '';
          try {
            content = readFileSync(abs, 'utf8');
          } catch {
            return '';
          }
          const m = content.match(/<svg\b([^>]*)>([\s\S]*?)<\/svg>/i);
          const inner = (m ? m[2] : content)
            .replace(/<\/*symbol[^>]*>/gi, '')
            .replace(/<\/*defs[^>]*>/gi, '')
            // Drop namespace-prefixed attributes that lose their prefix in the merged sprite.
            .replace(/\s+[a-zA-Z0-9_-]+:[a-zA-Z0-9_.-]+="[^"]*"/g, '')
            .trim();
          const attrs = m ? m[1] : '';
          const vb = attrs.match(/\bviewBox="([^"]+)"/i);
          const viewBoxAttr = vb ? ` viewBox="${vb[1]}"` : '';
          return `<symbol id="${makeId(abs)}"${viewBoxAttr}>${inner}</symbol>`;
        })
        .filter(Boolean);

      const sprite = [
        '<svg xmlns="http://www.w3.org/2000/svg" style="display:none">',
        ...symbols,
        '</svg>\n',
      ].join('\n');

      this.emitFile({
        type: 'asset',
        fileName: 'assets/icons.svg',
        source: sprite,
      });
    },
  };
}

/* ============================================================================
 * Plugin: Relativize CSS asset URLs
 * ========================================================================== */

/**
 * Rewrites any `url(assets/...)` found in emitted CSS to a path relative to
 * the CSS file's directory. This preserves authored relative URLs even when
 * Vite emits CSS into nested folders.
 *
 * @param {{ assetsRoot?: string }} [opts]
 * @returns {import('vite').PluginOption}
 */
function cssAssetUrlRelativizer({ assetsRoot = 'assets' } = {}) {
  return {
    name: 'emulsify-css-asset-url-relativizer',
    apply: 'build',
    generateBundle(_, bundle) {
      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (chunk.type !== 'asset') continue;
        if (!fileName.endsWith('.css')) continue;
        if (typeof chunk.source !== 'string') continue;

        const fromDir = pathPosix.dirname(fileName);

        chunk.source = chunk.source.replace(
          /url\((['"]?)\/?assets\/([^)'"]+)\1\)/g,
          (match, quote = '', rest) => {
            const target = pathPosix.join(assetsRoot, rest);
            const rel = pathPosix.relative(fromDir, target);
            return `url(${quote}${rel}${quote})`;
          },
        );
      }
    },
  };
}

/* ============================================================================
 * Plugin: Mirror `dist/components/**` to `./components/**` (Drupal only)
 * ========================================================================== */

/**
 * Mirrors built component files to the project root `./components/` directory
 * when enabled. Drupal projects with `src/` present need this for SDC output.
 * After copying, originals in `dist/components/` are deleted and empty folders
 * are pruned.
 *
 * @param {{ enabled: boolean, projectDir: string }} opts
 * @returns {import('vite').PluginOption}
 */
function mirrorComponentsToRoot({ enabled, projectDir }) {
  let outDir = 'dist';
  return {
    name: 'emulsify-mirror-components-to-root',
    apply: 'build',
    enforce: 'post',
    configResolved(cfg) {
      outDir = cfg.build?.outDir || 'dist';
    },
    closeBundle() {
      if (!enabled) return;
      const distComponents = join(outDir, 'components');
      if (!existsSync(distComponents)) return;

      for (const srcFile of walkFiles(distComponents)) {
        const relFromOutDir = srcFile.slice(join(outDir, '').length);
        const destFile = join(projectDir, relFromOutDir);
        mkdirSync(dirname(destFile), { recursive: true });
        try {
          if (!filesHaveSameBytes(srcFile, destFile)) {
            copyFileSync(srcFile, destFile);
          }
          try {
            unlinkSync(srcFile);
            pruneEmptyDirsUpTo(dirname(srcFile), distComponents);
          } catch {
            /* noop */
          }
        } catch (e) {
          console.warn(
            `Mirror copy failed for ${relFromOutDir}: ${e?.message || e}`,
          );
        }
      }
      pruneEmptyDirsUpTo(distComponents, outDir);
    },
  };
}

/* ============================================================================
 * Factory: assemble all plugins for this environment
 * ========================================================================== */

/**
 * Create the Vite plugin array used by Emulsify builds.
 *
 * @param {{
 *   projectDir: string,
 *   platform: string,
 *   srcDir: string,
 *   srcExists: boolean,
 *   structureOverrides?: boolean
 * }} env
 * @returns {import('vite').PluginOption[]}
 */
export function makePlugins(env) {
  const { projectDir, platform } = env;
  const platformAdapter = env.platformAdapter || getPlatformAdapter(platform);
  const structure =
    env.projectStructure ||
    resolveProjectStructure({
      ...env,
      platformAdapter,
    });
  const twigOptions = makeTwigPluginOptions(env);
  const sourceFileIndex = createSourceFileIndex(structure);

  const basePlugins = [
    emulsifyTwigModulePlugin(twigOptions),

    // Generic Twig rendering for dev/preview.
    ...makeTwigPlugins(env, twigOptions),

    // Emit a physical dist/assets/icons.svg sprite.
    svgSpriteFilePlugin({
      include: [
        `${projectDir.replace(/\\/g, '/')}/assets/icons/**/*.svg`,
        'assets/icons/**/*.svg',
        'src/assets/icons/**/*.svg',
        'src/**/icons/**/*.svg',
      ],
      symbolId: '[name]',
    }),

    // Sass glob imports preserve existing component stylesheet patterns.
    sassGlobImports(),

    // YAML support lets component metadata import into Vite modules.
    yml(),

    // Keep CSS asset URLs relative to the emitted CSS location.
    cssAssetUrlRelativizer({ assetsRoot: 'assets' }),
  ];

  return [
    ...basePlugins,

    // Copy Twig templates and component metadata beside compiled assets.
    copyTwigFilesPlugin({ structure, sourceFileIndex }),

    // Copy every non-code asset under src with the same routing.
    copyAllSrcAssetsPlugin({ structure, sourceFileIndex }),

    // Drupal projects with src mirror dist/components back to ./components.
    mirrorComponentsToRoot({
      enabled: structure.mirrorComponentOutput,
      projectDir,
    }),
  ];
}
