import path from 'path';
import viteConfig from '../config/vite/vite.config.js';
import { twigExtensionModuleSpecifiers } from '../config/vite/twig-extensions.js';
import {
  mergeReactSingletonOptimizeDeps,
  mergeReactSingletonResolve,
} from '../config/vite/utils/react-singleton.js';
import { makeGeneratedDistFilesPlugin } from './main-static-assets.js';

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
  };
}
