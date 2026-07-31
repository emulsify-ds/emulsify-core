import path from 'path';
import viteConfig from '../config/vite/vite.config.js';
import { twigExtensionModuleSpecifiers } from '../config/vite/plugins/twig/extensions.js';
import {
  mergeReactSingletonOptimizeDeps,
  mergeReactSingletonResolve,
} from '../config/vite/utils/react-singleton.js';
import { createDevServerLogger } from '../config/vite/plugins/reporter/vite-logger.js';
import { makeGeneratedDistFilesPlugin } from './main-static-assets.js';

// Twig glob maps are provided by config/vite/plugins/twig/virtual-twig-globs.js.
const twigVirtualModuleIds = [
  'virtual:emulsify-twig-globs',
  'virtual:emulsify-twig-asset-sources',
  'virtual:emulsify-twig-asset-source-runtime',
  'virtual:emulsify-twig-extension-installers',
];

const twigRuntimeOptimizeDepsExclude = [
  ...twigVirtualModuleIds,
  '@emulsify/core/storybook/twig/source-function',
  '@emulsify/core/storybook/twig/source',
  '@emulsify/core/storybook/twig/resolver',
];

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
 * Drop Vite's legacy `rollupOptions` alias from an `optimizeDeps` object.
 *
 * Vite 8 installs a compat shim on resolved `optimizeDeps` that defines
 * `rollupOptions` as an *enumerable accessor* forwarding to `rolldownOptions`.
 * Spreading such an object — which is how Storybook's config is merged here —
 * copies the alias out as an ordinary data property. Vite then sees an
 * `optimizeDeps` carrying two distinct objects and logs:
 *
 *   `optimizeDeps.rollupOptions` / `ssr.optimizeDeps.rollupOptions` is
 *   deprecated. Use `optimizeDeps.rolldownOptions` instead.
 *
 * `ssr.optimizeDeps` inherits from `optimizeDeps`, so clearing the alias here
 * settles both. Anything the alias was carrying is folded into
 * `rolldownOptions` rather than discarded, so behavior is unchanged.
 *
 * That deprecation is emitted with `console.warn` rather than through Vite's
 * logger, so it cannot be intercepted downstream — it has to be prevented.
 *
 * @param {object} [optimizeDeps] - Resolved or partial optimizeDeps config.
 * @returns {object} Copy with the alias resolved into `rolldownOptions`.
 */
export function stripRollupOptionsAlias(optimizeDeps) {
  if (!optimizeDeps) return {};

  const { rollupOptions, rolldownOptions, ...rest } = optimizeDeps;
  const resolved = rolldownOptions || rollupOptions;

  return resolved ? { ...rest, rolldownOptions: resolved } : rest;
}

/**
 * Virtual module IDs that must stay external during dependency optimization.
 *
 * @type {RegExp}
 */
const TWIG_VIRTUAL_MODULE_PATTERN =
  /^virtual:emulsify-twig-(?:globs|asset-sources|asset-source-runtime)$/;

/**
 * Keep Emulsify Twig virtual imports out of Storybook dependency prebundles.
 *
 * Vite 8 optimizes dependencies with Rolldown rather than esbuild, so this is a
 * Rolldown plugin using the Rollup-compatible `resolveId` hook. It replaces the
 * previous esbuild `onResolve` plugin, which reached Vite through the
 * deprecated `optimizeDeps.esbuildOptions` escape hatch.
 *
 * @returns {import('rolldown').Plugin} Rolldown plugin for optimizeDeps.
 */
function makeTwigVirtualModuleOptimizerPlugin() {
  return {
    name: 'emulsify-twig-virtual-modules',
    resolveId(source) {
      if (!TWIG_VIRTUAL_MODULE_PATTERN.test(source)) return null;

      // Marking these external leaves them in the module graph for Emulsify's
      // virtual plugins to resolve during the normal Vite pipeline.
      return { id: source, external: true };
    },
  };
}

/**
 * Builds the Storybook Vite config merger.
 *
 * @param {object} resolvedStorybookEnv - Resolved project paths used by Storybook.
 * @returns {Function} Storybook `viteFinal` callback.
 */
export function createViteFinal(resolvedStorybookEnv) {
  return async function viteFinal(config) {
    const { createLogger, mergeConfig } = await import('vite');
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
    // Clear Vite's legacy `rollupOptions` alias before either object is
    // spread, so the merged result never carries both it and `rolldownOptions`.
    const baseOptimizeDeps = stripRollupOptionsAlias(
      baseViteConfig?.optimizeDeps,
    );
    const storybookOptimizeDeps = stripRollupOptionsAlias(config?.optimizeDeps);

    const optimizeDepsInclude = mergeReactSingletonOptimizeDeps(
      baseOptimizeDeps.include,
      storybookOptimizeDeps.include,
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
        ...baseOptimizeDeps,
        ...storybookOptimizeDeps,
        include: optimizeDepsInclude,
        exclude: mergeTwigRuntimeOptimizeDepsExcludes(
          baseOptimizeDeps.exclude,
          storybookOptimizeDeps.exclude,
        ),
        rolldownOptions: {
          ...(baseOptimizeDeps.rolldownOptions || {}),
          ...(storybookOptimizeDeps.rolldownOptions || {}),
          plugins: [
            ...(baseOptimizeDeps.rolldownOptions?.plugins || []),
            ...(storybookOptimizeDeps.rolldownOptions?.plugins || []),
            makeTwigVirtualModuleOptimizerPlugin(),
          ],
          moduleTypes: {
            ...(baseOptimizeDeps.rolldownOptions?.moduleTypes || {}),
            ...(storybookOptimizeDeps.rolldownOptions?.moduleTypes || {}),
            // Pre-bundle `.js` dependencies as JSX for packages that ship JSX
            // without a `.jsx` extension. Rolldown's `moduleTypes` is the
            // successor to esbuild's `loader` map.
            '.js': 'jsx',
          },
        },
      },
    });

    const mergedOptimizeDeps = stripRollupOptionsAlias(
      mergedConfig.optimizeDeps,
    );

    return {
      ...mergedConfig,

      // Assigned after the merge rather than inside it, because `mergeConfig`
      // deep-merges plain objects and a logger is an object of functions — merging
      // Storybook's with ours would produce a hybrid belonging to neither. Spread
      // last, it simply wins, and it delegates to whatever was already configured
      // so Storybook keeps its prefixes for every message it is allowed to print.
      customLogger: createDevServerLogger({
        baseLogger: mergedConfig.customLogger || createLogger(),
      }),
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
        // `mergeConfig` walks enumerable keys, so the alias can reappear on the
        // merged result even though both inputs were cleaned above.
        ...mergedOptimizeDeps,
        include: mergeReactSingletonOptimizeDeps(mergedOptimizeDeps.include),
        exclude: mergeTwigRuntimeOptimizeDepsExcludes(
          mergedOptimizeDeps.exclude,
        ),
        rolldownOptions: {
          ...(mergedOptimizeDeps.rolldownOptions || {}),
          moduleTypes: {
            ...(mergedOptimizeDeps.rolldownOptions?.moduleTypes || {}),
            '.js': 'jsx',
          },
        },
      },
    };
  };
}
