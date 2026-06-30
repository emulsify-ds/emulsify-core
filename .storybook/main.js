/**
 * Central Storybook configuration for Emulsify.
 *
 * This shared config defines the default Storybook behavior for consumers of
 * the package, then lets a project layer local overrides on top at the end.
 * The main custom behavior here is:
 * - injecting manager/preview head markup
 * - adapting the shared Vite config for Storybook
 * - wiring Twig template discovery into the Storybook build
 *
 * @module .storybook/main
 */

import fs from 'fs';
import path, { resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import viteConfig from '../config/vite/vite.config.js';
import { resolveEnvironment } from '../config/vite/environment.js';
import {
  mergeReactSingletonOptimizeDeps,
  mergeReactSingletonResolve,
} from '../config/vite/utils/react-singleton.js';
import { twigExtensionModuleSpecifiers } from '../config/vite/twig-extensions.js';
import {
  applyStorybookConfigOverrides,
  normalizeStorybookConfigOverrideModule,
} from '../src/storybook/main-config.js';

// Twig glob maps are provided by config/vite/plugins/virtual-twig-globs.js.

const twigVirtualModuleIds = [
  'virtual:emulsify-twig-globs',
  'virtual:emulsify-twig-asset-sources',
  'virtual:emulsify-twig-extension-installers',
];

const twigRuntimeOptimizeDepsExclude = [
  ...twigVirtualModuleIds,
  '@emulsify/core/storybook/twig/source-function',
  '@emulsify/core/storybook/twig/source',
  '@emulsify/core/storybook/twig/resolver',
];

/**
 * Minimal subset of the resolved Emulsify environment used by this file.
 *
 * @typedef {object} StorybookEnvironment
 * @property {string} projectDir - Absolute path to the consuming project root.
 * @property {boolean} [structureOverrides] - Whether custom structure roots are enabled.
 * @property {string[]} [structureRoots] - Absolute component root paths when overrides are active.
 * @property {string[]} [componentRoots] - Absolute component roots in resolution order.
 * @property {Record<string, string>} [namespaceRoots] - Twig namespace roots.
 * @property {string} [srcDir] - Absolute path to the project's `src` directory when present.
 */

/**
 * Storybook config type used for editor hints in this plain JS file.
 * @typedef {import('@storybook/core-common').StorybookConfig} StorybookConfig
 */

/**
 * The full path to the current file (ESM compatible).
 * @type {string}
 */
const _filename = fileURLToPath(import.meta.url);

/**
 * The directory name of the current module file.
 * @type {string}
 */
const _dirname = path.dirname(_filename);

/**
 * The consuming project root for Storybook static mounts.
 *
 * Storybook loads this package config from different physical locations
 * depending on whether Core is linked locally or installed in node_modules, so
 * static paths must be rooted at the process cwd rather than this file.
 *
 * @type {string}
 */
const projectRoot = process.cwd();

/**
 * Vite-generated Storybook chunks should not share `/assets` with project
 * static files. Storybook copies staticDirs while the preview build runs, so
 * keeping generated chunks in a separate folder avoids concurrent writers in
 * `.out/assets`.
 *
 * @type {string}
 */
const storybookViteAssetsDir = 'storybook-assets';

/**
 * Reads an optional HTML fragment relative to this config file.
 *
 * Missing files are treated as empty content so downstream projects can opt in
 * to extra markup without making Storybook fail on startup.
 *
 * @param {string} relativePath - Relative path from this file to the HTML fragment.
 * @returns {string} File contents when the fragment exists, otherwise an empty string.
 */
function readOptionalHtmlFragment(relativePath) {
  const fragmentPath = resolve(_dirname, relativePath);

  if (!fs.existsSync(fragmentPath)) {
    return '';
  }

  return fs.readFileSync(fragmentPath, 'utf8');
}

/**
 * Keeps Storybook static directory config aligned to the consuming project.
 *
 * Storybook errors when a declared static directory is absent, so only expose
 * project asset directories that exist in the current workspace.
 *
 * @param {Array<string|{from: string, to: string}>} staticDirs - Static directory entries.
 * @returns {Array<string|{from: string, to: string}>} Existing static directory entries.
 */
function existingStaticDirs(staticDirs) {
  const seen = new Set();
  const existing = [];

  for (const staticDir of staticDirs) {
    const directory =
      typeof staticDir === 'string' ? staticDir : staticDir.from;

    if (!directory || !fs.existsSync(directory)) continue;

    const key =
      typeof staticDir === 'string'
        ? staticDir
        : `${staticDir.from || ''}\0${staticDir.to || ''}`;
    if (seen.has(key)) continue;

    seen.add(key);
    existing.push(staticDir);
  }

  return existing;
}

/**
 * Build static directory mounts for normalized project asset roots.
 *
 * @param {StorybookEnvironment} env - Resolved project paths used by Storybook.
 * @returns {Array<string|{from: string, to: string}>} Static directory entries.
 */
function buildAssetStaticDirs(env) {
  const configuredAssetRoots = Array.isArray(env.projectStructure?.assetRoots)
    ? env.projectStructure.assetRoots
    : [];
  const assetRoots = [
    ...configuredAssetRoots,
    path.resolve(projectRoot, 'assets'),
    path.resolve(projectRoot, 'src/assets'),
  ];

  return existingStaticDirs([
    ...assetRoots.map((root) => ({
      from: root,
      to: '/assets',
    })),
    {
      from: path.resolve(projectRoot, 'dist/assets'),
      to: '/assets',
    },
    {
      from: path.resolve(projectRoot, 'dist/assets'),
      to: '/',
    },
  ]);
}

/**
 * Checks whether a resolved file path stays inside an expected directory.
 *
 * @param {string} filePath - Resolved candidate file path.
 * @param {string} directory - Resolved directory that must contain the file.
 * @returns {boolean} Whether the file path is inside the directory.
 */
function isWithinDirectory(filePath, directory) {
  // `path.relative()` exposes traversal attempts as `..` or absolute paths.
  const relativePath = path.relative(directory, filePath);
  return Boolean(
    relativePath &&
    !relativePath.startsWith('..') &&
    !path.isAbsolute(relativePath),
  );
}

/**
 * Returns a browser content type for generated files served by Storybook.
 *
 * @param {string} filePath - Resolved file path being served.
 * @returns {string} HTTP content type header value.
 */
function contentTypeForFile(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  // Keep this map small; unknown generated files can still download as binary.
  const types = {
    '.css': 'text/css; charset=utf-8',
    '.gif': 'image/gif',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml; charset=utf-8',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
  };

  return types[extension] || 'application/octet-stream';
}

/**
 * Serves generated dist files that may not exist when `staticDirs` is built.
 *
 * Storybook validates static directories during config load, but Emulsify
 * projects often generate `dist` after Storybook starts. This middleware keeps
 * those generated asset URLs available without replacing Vite's CSS HMR.
 *
 * @param {import('http').IncomingMessage} req - Vite dev server request.
 * @param {import('http').ServerResponse} res - Vite dev server response.
 * @param {Function} next - Next middleware callback.
 * @returns {void}
 */
function serveGeneratedDistFile(req, res, next) {
  const method = req.method || 'GET';
  if (method !== 'GET' && method !== 'HEAD') {
    next();
    return;
  }

  let pathname = '';
  try {
    // Malformed URLs should fall through to Storybook's normal Vite server.
    pathname = decodeURIComponent(
      new URL(req.url || '/', 'http://localhost').pathname,
    );
  } catch {
    next();
    return;
  }

  // These URL shapes match Emulsify's compiled CSS and sprite references.
  const routes = [
    {
      pathname: '/icons.svg',
      file: path.resolve(projectRoot, 'dist/assets/icons.svg'),
    },
    {
      prefix: '/assets/',
      directory: path.resolve(projectRoot, 'dist/assets'),
    },
    {
      prefix: '/dist/',
      directory: path.resolve(projectRoot, 'dist'),
    },
  ];
  const route = routes.find(({ prefix, pathname: routePathname }) =>
    routePathname ? pathname === routePathname : pathname.startsWith(prefix),
  );
  if (!route) {
    next();
    return;
  }

  const filePath = route.file
    ? route.file
    : path.resolve(route.directory, pathname.slice(route.prefix.length));
  // Resolve from known roots only, then reject traversal before reading.
  if (route.directory && !isWithinDirectory(filePath, route.directory)) {
    next();
    return;
  }

  try {
    const stats = fs.statSync(filePath);
    if (!stats.isFile()) {
      next();
      return;
    }
    if (path.extname(filePath).toLowerCase() === '.css') {
      next();
      return;
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', contentTypeForFile(filePath));
    res.setHeader('Content-Length', stats.size);
    if (method === 'HEAD') {
      res.end();
      return;
    }
    res.end(fs.readFileSync(filePath));
  } catch {
    next();
  }
}

/**
 * Adds Vite dev-server access to generated dist files.
 *
 * CSS itself is still imported through native `import.meta.glob()` calls in the
 * preview runtime; this plugin only fills the static-file gap for late-created
 * dist assets.
 *
 * @returns {import('vite').Plugin} Vite middleware plugin.
 */
function makeGeneratedDistFilesPlugin() {
  return {
    name: 'emulsify-generated-dist-files',
    configureServer(server) {
      server.middlewares.use(serveGeneratedDistFile);
      // Watch generated assets so Vite notices files created after startup.
      server.watcher.add([
        path.join(projectRoot, 'dist/**/*.css'),
        path.join(projectRoot, 'dist/assets/**/*'),
      ]);
    },
  };
}

/**
 * Merge Storybook and project optimizeDeps excludes with Core Twig runtime IDs.
 *
 * Storybook's dependency optimizer runs before normal Vite virtual module
 * resolution. Core Twig runtime modules import virtual IDs that must stay in
 * the Vite module graph so Emulsify's virtual plugins can resolve them.
 *
 * @param {...string[]} excludeLists - Existing optimizeDeps exclude arrays.
 * @returns {string[]} Merged exclude list.
 */
function mergeTwigRuntimeOptimizeDepsExcludes(...excludeLists) {
  return Array.from(
    new Set([
      ...excludeLists.flatMap((excludeList) =>
        Array.isArray(excludeList) ? excludeList : [],
      ),
      ...twigRuntimeOptimizeDepsExclude,
    ]),
  );
}

/**
 * Keep Emulsify Twig virtual imports out of Storybook dependency prebundles.
 *
 * @returns {import('esbuild').Plugin} Esbuild plugin for optimizeDeps.
 */
function makeTwigVirtualModuleOptimizerPlugin() {
  return {
    name: 'emulsify-twig-virtual-modules',
    setup(build) {
      build.onResolve(
        { filter: /^virtual:emulsify-twig-(?:globs|asset-sources)$/ },
        (args) => ({
          path: args.path,
          external: true,
        }),
      );
    },
  };
}

/**
 * Reads optional project-level Storybook overrides.
 *
 * Downstream projects can provide this file, but the shared config also needs
 * to load in package-level smoke tests where that project file is absent.
 *
 * @returns {Promise<{ config: object|Function, extendConfig?: Function, replaceAddons: boolean }>}
 * Consumer overrides.
 */
async function loadConfigOverrides() {
  const overridePath = resolve(
    _dirname,
    '../../../../config/emulsify-core/storybook/main.js',
  );

  if (!fs.existsSync(overridePath)) {
    return normalizeStorybookConfigOverrideModule();
  }

  const configOverrides = await import(pathToFileURL(overridePath).href);
  return normalizeStorybookConfigOverrideModule(configOverrides);
}

/**
 * Builds Storybook story globs from normalized project roots.
 *
 * Stories remain colocated with components, whether the project uses the
 * recommended `src/components` layout, legacy root `components`, or explicit
 * structure implementation directories.
 *
 * @param {StorybookEnvironment} env - Resolved project paths used by Storybook.
 * @returns {string[]} Storybook story globs.
 */
function buildStoryGlobs(env) {
  if (Array.isArray(env.projectStructure?.storyRoots)) {
    return env.projectStructure.storyRoots.map((root) =>
      path
        .resolve(root, '**/*.stories.@(js|jsx|ts|tsx)')
        .split(path.sep)
        .join('/'),
    );
  }

  const roots =
    env.structureOverrides &&
    Array.isArray(env.structureRoots) &&
    env.structureRoots.length
      ? env.structureRoots
      : [
          path.resolve(env.projectDir, 'src'),
          path.resolve(env.projectDir, 'components'),
        ];

  return Array.from(new Set(roots.filter(Boolean))).map((root) =>
    path
      .resolve(root, '**/*.stories.@(js|jsx|ts|tsx)')
      .split(path.sep)
      .join('/'),
  );
}

/**
 * Safely apply any user-provided overrides or fall back to an empty object.
 * @type {object}
 */
const safeConfigOverrides = await loadConfigOverrides();

/**
 * Environment details shared across this Storybook config load.
 * @type {StorybookEnvironment}
 */
const resolvedStorybookEnv = resolveEnvironment();

/**
 * Primary Storybook configuration object.
 * @type {StorybookConfig}
 */
const baseConfig = {
  /**
   * Discover stories from both supported component roots.
   *
   * This shared config supports projects that keep stories under `src` as well
   * as projects that expose a top-level `components` directory.
   *
   * @type {string[]}
   */
  stories: buildStoryGlobs(resolvedStorybookEnv),

  /**
   * Mount shared assets into Storybook's static file server.
   *
   * Anything referenced by URL inside stories should live in one of these
   * directories so it works in both `storybook dev` and static builds.
   *
   * @type {Array<string|{from: string, to: string}>}
   */
  staticDirs: buildAssetStaticDirs(resolvedStorybookEnv),

  /**
   * Enable the default addon set used by Emulsify.
   *
   * `a11y` adds accessibility tooling, `links` supports story-to-story
   * navigation, and `themes` exposes theme switching in the Storybook UI.
   *
   * @type {string[]}
   */
  addons: [
    '@storybook/addon-a11y',
    '@storybook/addon-links',
    '@storybook/addon-themes',
  ],

  /**
   * Force the Vite builder and disable Storybook telemetry for shared usage.
   * @type {{builder: string, disableTelemetry: boolean}}
   */
  core: {
    builder: '@storybook/builder-vite',
    disableTelemetry: true,
  },

  /**
   * Tell Storybook to use the React + Vite framework package.
   * @type {{name: string, options: object}}
   */
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },

  /**
   * Disable automatic docs generation.
   *
   * Storybook will only render documentation pages that are authored
   * explicitly instead of generating them from component metadata.
   *
   * @type {{autodocs: boolean}}
   */
  docs: {
    autodocs: false,
  },

  /**
   * Appends Emulsify branding to the Storybook manager UI.
   *
   * This only affects Storybook's chrome, such as the sidebar, toolbar, and
   * addon panels. It does not affect the iframe where stories actually render.
   *
   * @param {string} head - Existing manager head markup provided by Storybook.
   * @returns {string} Manager head markup with Emulsify additions appended.
   */
  managerHead: (head) => {
    const managerStyles = readOptionalHtmlFragment('./manager-head.css');
    const inlineStyles = managerStyles
      ? `<style>
${managerStyles}
</style>`
      : '';
    const externalManagerHtml = readOptionalHtmlFragment(
      '../../../../config/emulsify-core/storybook/manager-head.html',
    );

    return `${head}
      ${inlineStyles}
      ${externalManagerHtml}`;
  },

  /**
   * Appends project-level head markup to the story preview iframe.
   *
   * This is the place for preview-only fonts, scripts, or meta tags that the
   * rendered component output depends on.
   *
   * @param {string} head - Existing preview head markup provided by Storybook.
   * @returns {string} Preview head markup with optional project HTML appended.
   */
  previewHead: (head) => {
    const externalHtml = readOptionalHtmlFragment(
      '../../../../config/emulsify-core/storybook/preview-head.html',
    );

    return `${head}
      ${externalHtml}`;
  },

  /**
   * Merges Storybook's generated Vite config with Emulsify's shared Vite config.
   *
   * Storybook supplies a baseline config, but Emulsify still needs to expose
   * the resolved environment, expand filesystem access, and expose the Twig
   * virtual glob module used by the runtime resolver.
   *
   * @param {import('vite').UserConfig} config - Storybook's generated Vite config.
   * @returns {Promise<import('vite').UserConfig>} Final Vite config used by Storybook.
   */
  async viteFinal(config) {
    const { mergeConfig } = await import('vite');
    /** @type {StorybookEnvironment} */
    const env = resolvedStorybookEnv;
    const storybookBuildConfig = config?.build || {};

    // Keep using the `serve` branch of the shared Vite config here. Storybook
    // has historically consumed that branch, while `mode` still reflects
    // whether Storybook is running in development or production.
    const mode = config?.mode || 'development';
    const baseViteConfig =
      typeof viteConfig === 'function'
        ? await viteConfig({ command: 'serve', mode })
        : viteConfig;
    const existingDefine = (config && config.define) || {};
    const viteDefine = (baseViteConfig && baseViteConfig.define) || {};

    // Allow Storybook's dev server to read component sources from the project
    // root and any structure override paths used by Emulsify consumers.
    const allowList = new Set([
      ...(config?.server?.fs?.allow || []),
      env.projectDir,
      path.resolve(env.projectDir, 'src'),
      path.resolve(env.projectDir, 'components'),
      path.resolve(env.projectDir, 'dist'),
      ...(Array.isArray(env.projectStructure?.sourceRoots)
        ? env.projectStructure.sourceRoots
        : []),
      ...(Array.isArray(env.componentRoots) ? env.componentRoots : []),
      ...(Array.isArray(env.structureRoots) ? env.structureRoots : []),
      ...(env.namespaceRoots && typeof env.namespaceRoots === 'object'
        ? Object.values(env.namespaceRoots)
        : []),
      ...(Array.isArray(env.projectStructure?.assetRoots)
        ? env.projectStructure.assetRoots
        : []),
    ]);

    // Twig files are loaded through custom resolvers/plugins, so they need to
    // be treated as importable assets by Storybook's Vite pipeline.
    const assetsInclude = Array.from(
      new Set([
        ...(config.assetsInclude || []),
        ...(baseViteConfig.assetsInclude || []),
        '**/*.twig',
      ]),
    );
    const optimizeDepsInclude = mergeReactSingletonOptimizeDeps(
      baseViteConfig?.optimizeDeps?.include,
      config?.optimizeDeps?.include,
      [
        'twig',
        '@emulsify/core/extensions/twig',
        ...twigExtensionModuleSpecifiers(env),
      ],
    );

    const mergedConfig = mergeConfig(config, {
      ...baseViteConfig,
      resolve: mergeReactSingletonResolve(baseViteConfig, config),
      define: {
        // Preserve shared and Storybook-provided constants, then publish the
        // resolved Emulsify environment to client-side code.
        ...viteDefine,
        ...existingDefine,
        __EMULSIFY_ENV__: JSON.stringify(env),
        'globalThis.__EMULSIFY_ENV__': JSON.stringify(env),
      },
      server: {
        ...(baseViteConfig?.server || {}),
        fs: {
          allow: Array.from(allowList),
        },
      },
      assetsInclude,
      plugins: [
        ...(baseViteConfig?.plugins || []),
        makeGeneratedDistFilesPlugin(),
      ],
      esbuild: {
        // Some downstream code is authored as `.js` files containing JSX, so
        // keep Storybook's esbuild settings aligned with the shared Vite config.
        jsx: 'automatic',
        loader: 'jsx',
        include: /.*\.jsx?$/,
        exclude: [],
      },
      optimizeDeps: {
        ...(baseViteConfig?.optimizeDeps || {}),
        ...(config?.optimizeDeps || {}),
        include: optimizeDepsInclude,
        exclude: mergeTwigRuntimeOptimizeDepsExcludes(
          baseViteConfig?.optimizeDeps?.exclude,
          config?.optimizeDeps?.exclude,
        ),
        esbuildOptions: {
          ...(baseViteConfig?.optimizeDeps?.esbuildOptions || {}),
          ...(config?.optimizeDeps?.esbuildOptions || {}),
          plugins: [
            ...(baseViteConfig?.optimizeDeps?.esbuildOptions?.plugins || []),
            ...(config?.optimizeDeps?.esbuildOptions?.plugins || []),
            makeTwigVirtualModuleOptimizerPlugin(),
          ],
          loader: {
            ...(baseViteConfig?.optimizeDeps?.esbuildOptions?.loader || {}),
            ...(config?.optimizeDeps?.esbuildOptions?.loader || {}),
            // Pre-bundle `.js` dependencies with the JSX loader for packages
            // that ship JSX without a `.jsx` extension.
            '.js': 'jsx',
          },
        },
      },
    });

    return {
      ...mergedConfig,
      build: {
        ...(mergedConfig.build || {}),
        ...(storybookBuildConfig.outDir
          ? { outDir: storybookBuildConfig.outDir }
          : {}),
        assetsDir: storybookViteAssetsDir,
        emptyOutDir: false,
      },
      resolve: mergeReactSingletonResolve(mergedConfig),
      optimizeDeps: {
        ...(mergedConfig.optimizeDeps || {}),
        include: mergeReactSingletonOptimizeDeps(
          mergedConfig.optimizeDeps?.include,
        ),
        exclude: mergeTwigRuntimeOptimizeDepsExcludes(
          mergedConfig.optimizeDeps?.exclude,
        ),
        esbuildOptions: {
          ...(mergedConfig.optimizeDeps?.esbuildOptions || {}),
          loader: {
            ...(mergedConfig.optimizeDeps?.esbuildOptions?.loader || {}),
            '.js': 'jsx',
          },
        },
      },
    };
  },
};

/**
 * Primary Storybook configuration after project overrides have been applied.
 * Project `addons` append to Emulsify defaults unless replacement is requested.
 *
 * @type {StorybookConfig}
 */
const config = await applyStorybookConfigOverrides(
  baseConfig,
  safeConfigOverrides,
  { env: resolvedStorybookEnv },
);

export default config;
