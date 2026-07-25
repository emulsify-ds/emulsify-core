import path from 'path';
import viteConfig from '../config/vite/vite.config.js';
import { twigExtensionModuleSpecifiers } from '../config/vite/plugins/twig/extensions.js';
import {
  mergeReactSingletonOptimizeDeps,
  mergeReactSingletonResolve,
} from '../config/vite/utils/react-singleton.js';
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
    const { mergeConfig } = await import('vite');
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
        rolldownOptions: {
          ...(baseViteConfig?.optimizeDeps?.rolldownOptions || {}),
          ...(config?.optimizeDeps?.rolldownOptions || {}),
          plugins: [
            ...(baseViteConfig?.optimizeDeps?.rolldownOptions?.plugins || []),
            ...(config?.optimizeDeps?.rolldownOptions?.plugins || []),
            makeTwigVirtualModuleOptimizerPlugin(),
          ],
          moduleTypes: {
            ...(baseViteConfig?.optimizeDeps?.rolldownOptions?.moduleTypes ||
              {}),
            ...(config?.optimizeDeps?.rolldownOptions?.moduleTypes || {}),
            // Pre-bundle `.js` dependencies as JSX for packages that ship JSX
            // without a `.jsx` extension. Rolldown's `moduleTypes` is the
            // successor to esbuild's `loader` map.
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
        rolldownOptions: {
          ...(mergedConfig.optimizeDeps?.rolldownOptions || {}),
          moduleTypes: {
            ...(mergedConfig.optimizeDeps?.rolldownOptions?.moduleTypes || {}),
            '.js': 'jsx',
          },
        },
      },
    };
  };
}
