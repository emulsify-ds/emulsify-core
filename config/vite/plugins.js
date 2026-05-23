/**
 * @file Vite plugins factory for Emulsify.
 *
 * @description
 *  - Copies TWIGs/metadata into `dist/` using the same routing rules as JS/CSS:
 *      • `src/components/**`         → `dist/components/**`
 *      • `src/!(components|util)/**` → `dist/global/**`
 *  - Copies **all non-code assets** found under `src/` to the same routed locations.
 *  - Builds a **physical** spritemap at `dist/assets/icons.sprite.svg`.
 *
 * Component Structure Overrides behavior:
 *  - When `env.structureOverrides === true`, we **skip** copying Twig and assets, and also
 *    **skip** platform-specific mirroring. (Only JS/CSS compile is needed.)
 */

import { resolve, join, dirname, basename, posix as pathPosix } from 'path';
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

const toPosixPath = (filePath) => filePath.replace(/\\/g, '/');

const includeTokenTypes = [
  'Twig.logic.type.embed',
  'Twig.logic.type.extends',
  'Twig.logic.type.from',
  'Twig.logic.type.import',
  'Twig.logic.type.include',
];

const isTwigModuleRequest = (id) => {
  const [filePath, query = ''] = id.split('?');
  if (!filePath.endsWith('.twig')) return false;
  return !query || query === 'twig' || !/(^|&)(raw|url)\b/.test(query);
};

const stripRequestQuery = (id) => id.split('?')[0];

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

const unique = (items) => [...new Set(items.filter(Boolean))];

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

const resolveExistingFile = (paths) =>
  paths.filter(Boolean).find((filePath) => {
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      return statSync(filePath).isFile();
    } catch {
      return false;
    }
  });

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

const compileTwigTemplate = (templateId, filePath, options) => {
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
  const overrideRoots = structureOverrides ? structureRoots : [];
  const root = firstExistingPath([srcDir, ...overrideRoots, projectDir]);

  return {
    root: root || srcDir || projectDir,
    namespaces: makeTwigNamespaces(env),
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

          const { twig } = Twig;

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
 * Depth-first walk to list **all files** (no directories) under a given root.
 * @param {string} rootDir
 * @returns {string[]}
 */
const walkFiles = (rootDir) => {
  const files = [];
  const stack = [rootDir];

  while (stack.length) {
    const currentDir = stack.pop();
    if (!currentDir) continue;

    let entryNames = [];
    try {
      entryNames = readdirSync(currentDir);
    } catch {
      continue; // unreadable directory
    }

    for (const name of entryNames) {
      const fullPath = join(currentDir, name);
      try {
        const stats = statSync(fullPath);
        if (stats.isDirectory()) stack.push(fullPath);
        else files.push(fullPath);
      } catch {
        // ignore unreadable entries
      }
    }
  }
  return files;
};

/**
 * Remove empty parent directories from a start directory **up to (but not including)**
 * a stopping boundary directory.
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
      // cannot remove (in use or permissions) → stop trying here
      break;
    }

    const parent = dirname(cursor);
    if (parent === cursor || parent === stopAbs) break;
    cursor = parent;
  }
};

/* ============================================================================
 * Plugin: Copy Twig files (+ component metadata) using JS/CSS-like routing
 * ========================================================================== */

/**
 * Copy Twig templates and component metadata from `src/` to `dist/`,
 * respecting the same routing used for JS/CSS.
 *
 * @param {{ srcDir: string }} opts
 * @returns {import('vite').PluginOption}
 */
function copyTwigFilesPlugin({ srcDir }) {
  let outDir = 'dist';
  const posix = (p) => p.replace(/\\/g, '/');

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
      // components/**/*.twig
      const componentTwigs = globSync(
        posix(join(srcDir, 'components/**/*.twig')),
      );
      for (const absPath of componentTwigs) {
        const relFromSrc = posix(absPath).split(posix(srcDir) + '/')[1]; // "components/x/y.twig"
        const withinComponents = relFromSrc.replace(/^components\//, '');
        if (isPartial(withinComponents)) continue; // skip `_*.twig`
        const destPath = join(outDir, 'components', withinComponents);
        mkdirSync(dirname(destPath), { recursive: true });
        try {
          copyFileSync(absPath, destPath);
        } catch {
          /* noop */
        }
      }

      // components/**/*.component.(yml|yaml|json)
      for (const pattern of [
        'components/**/*.component.@(yml|yaml)',
        'components/**/*.component.json',
      ]) {
        const metaFiles = globSync(posix(join(srcDir, pattern)));
        for (const absPath of metaFiles) {
          const rel = posix(absPath)
            .split(posix(srcDir) + '/')[1]
            .replace(/^components\//, '');
          const destPath = join(outDir, 'components', rel);
          mkdirSync(dirname(destPath), { recursive: true });
          try {
            copyFileSync(absPath, destPath);
          } catch {
            /* noop */
          }
        }
      }

      // global Twig: everything under src except components/, util/, and partials
      const globalTwigs = globSync(posix(join(srcDir, '**/*.twig')), {
        ignore: [
          posix(join(srcDir, 'components/**')),
          posix(join(srcDir, 'util/**')),
          posix(join(srcDir, '**/_*.twig')),
        ],
      });

      for (const absPath of globalTwigs) {
        const rel = posix(absPath).split(posix(srcDir) + '/')[1];
        const destPath = join(outDir, 'global', rel);
        mkdirSync(dirname(destPath), { recursive: true });
        try {
          copyFileSync(absPath, destPath);
        } catch {
          /* noop */
        }
      }
    },
  };
}

/* ============================================================================
 * Plugin: Copy **all non-code** assets under `src/` with the same routing
 * ========================================================================== */

/**
 * Copies anything in `src/` that is **not** a code/template file into
 * either `dist/components/**` or `dist/global/**`, preserving relative paths.
 *
 * Excludes: .js, .scss, .twig, source maps, and `*.component.(yml|yaml|json)`.
 *
 * @param {{ srcDir: string }} opts
 * @returns {import('vite').PluginOption}
 */
function copyAllSrcAssetsPlugin({ srcDir }) {
  let outDir = 'dist';
  const posix = (p) => p.replace(/\\/g, '/');

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
      // Component-side assets → dist/components
      const componentAssets = globSync(posix(join(srcDir, 'components/**/*')), {
        nodir: true,
        ignore: [
          posix(join(srcDir, 'components/**/*.js')),
          posix(join(srcDir, 'components/**/*.scss')),
          posix(join(srcDir, 'components/**/*.twig')),
          posix(join(srcDir, 'components/**/*.component.@(yml|yaml|json)')),
          posix(join(srcDir, 'components/**/*.map')),
        ],
      });
      for (const absPath of componentAssets) {
        const rel = posix(absPath)
          .split(posix(srcDir) + '/')[1]
          .replace(/^components\//, '');
        const destPath = join(outDir, 'components', rel);
        mkdirSync(dirname(destPath), { recursive: true });
        try {
          copyFileSync(absPath, destPath);
        } catch {
          /* noop */
        }
      }

      // Global-side assets → dist/global
      const globalAssets = globSync(posix(join(srcDir, '**/*')), {
        nodir: true,
        ignore: [
          posix(join(srcDir, 'components/**')),
          posix(join(srcDir, 'util/**')),
          posix(join(srcDir, '**/*.js')),
          posix(join(srcDir, '**/*.scss')),
          posix(join(srcDir, '**/*.twig')),
          posix(join(srcDir, '**/*.component.@(yml|yaml|json)')),
          posix(join(srcDir, '**/*.map')),
        ],
      });
      for (const absPath of globalAssets) {
        const rel = posix(absPath).split(posix(srcDir) + '/')[1];
        const destPath = join(outDir, 'global', rel);
        mkdirSync(dirname(destPath), { recursive: true });
        try {
          copyFileSync(absPath, destPath);
        } catch {
          /* noop */
        }
      }
    },
  };
}

/* ============================================================================
 * Plugin: Build a **physical** SVG spritemap at dist/assets/icons.sprite.svg
 * ========================================================================== */

/**
 * Builds a single SVG sprite file from a set of icon globs and emits it as
 * `assets/icons.sprite.svg`. Only the options you’re using are supported:
 *
 * @param {{ include: string|string[], symbolId?: string }} options
 * @returns {import('vite').PluginOption}
 */
function svgSpriteFilePlugin({ include, symbolId = '[name]' }) {
  const toArray = (x) => (Array.isArray(x) ? x : [x]).filter(Boolean);
  const posix = (p) => p.replace(/\\/g, '/');

  /** @type {string[]} */
  let patterns = [];

  return {
    name: 'emulsify-svg-sprite-file',
    apply: 'build',

    /** Register icons for watch. */
    buildStart() {
      patterns = toArray(include).map(posix);
      const files = patterns.flatMap((p) => globSync(p));
      for (const f of files) {
        try {
          this.addWatchFile(f);
        } catch {
          /* noop */
        }
      }
    },

    /** Concatenate all matched SVGs into a single sprite. */
    generateBundle() {
      const files = patterns
        .flatMap((p) => globSync(p))
        .sort((a, b) => posix(a).localeCompare(posix(b)));

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
          /url\((['"]?)(\/?)assets\/([^)'"]+)\1\)/g,
          (match, quote = '', _leadingSlash = '', rest) => {
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
 * Plugin: Mirror `dist/components/**` → `./components/**` (Drupal only)
 * ========================================================================== */

/**
 * Mirrors built component files to the project root’s `./components/` directory
 * when `enabled` is true (for Drupal with `src/` present). After copying, the originals
 * in `dist/components/` are deleted and any now-empty folders are pruned.
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
          copyFileSync(srcFile, destFile);
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
  const { projectDir, platform, srcDir, srcExists, structureOverrides } = env;
  const twigOptions = makeTwigPluginOptions(env);

  const basePlugins = [
    emulsifyTwigModulePlugin(twigOptions),

    // Generic Twig rendering for dev/preview.
    ...makeTwigPlugins(env, twigOptions),

    // Emit a physical `dist/assets/icons.svg`
    svgSpriteFilePlugin({
      include: [
        `${projectDir.replace(/\\/g, '/')}/assets/icons/**/*.svg`,
        'assets/icons/**/*.svg',
        'src/assets/icons/**/*.svg',
        'src/**/icons/**/*.svg',
      ],
      symbolId: '[name]',
    }),

    // Sass glob imports
    sassGlobImports(),

    // YAML support
    yml(),

    // Keep CSS asset URLs relative to the emitted CSS location.
    cssAssetUrlRelativizer({ assetsRoot: 'assets' }),
  ];

  // If component structure overrides are in play, skip copy/mirror plugins.
  if (structureOverrides) {
    return basePlugins;
  }

  return [
    ...basePlugins,

    // Copy Twig & metadata
    copyTwigFilesPlugin({ srcDir }),

    // Copy every non-code asset under src/ (fonts/images/audio/docs…) with same routing.
    copyAllSrcAssetsPlugin({ srcDir }),

    // For Drupal projects with a `src/` folder, mirror `dist/components/**` → `./components/**`.
    mirrorComponentsToRoot({
      enabled: srcExists && platform === 'drupal',
      projectDir,
    }),
  ];
}
