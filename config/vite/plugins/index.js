/**
 * @file Vite plugin composition for Emulsify.
 *
 * Assembles the shared plugin chain used by Vite and Storybook while delegating
 * each individual plugin concern to focused internal modules.
 */

import sassGlobImports from 'vite-plugin-sass-glob-import';

import { getPlatformAdapter } from '../platforms.js';
import { resolveProjectStructure } from '../project-structure.js';
import { toPosixPath } from '../utils/paths.js';
import { copyAllSrcAssetsPlugin } from './copy-src-assets.js';
import { copyTwigFilesPlugin } from './copy-twig-files.js';
import { cssAssetUrlRelativizer } from './css-asset-relativizer.js';
import { mirrorComponentsToRoot } from './mirror-components.js';
import { requireContextCompatPlugin } from './require-context.js';
import { createSourceFileIndex } from './source-file-index.js';
import { svgSpriteFilePlugin } from './svg-sprite.js';
import {
  emulsifyTwigModulePlugin,
  makeTwigPluginOptions,
} from './twig-module.js';
import { virtualTwigAssetSourcesPlugin } from './virtual-twig-asset-sources.js';
import { virtualTwigGlobsPlugin } from './virtual-twig-globs.js';
import { makeTwigPlugins } from './vituum-patch.js';
import { yamlModulePlugin } from './yaml-module.js';

/**
 * Create the Vite plugin array used by Emulsify builds.
 *
 * @param {{
 *   projectDir: string,
 *   platform: string,
 *   srcDir: string,
 *   srcExists: boolean,
 *   structureOverrides?: boolean
 * }} env - Project environment.
 * @returns {import('vite').PluginOption[]} Emulsify Vite plugins.
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
  const envWithStructure = { ...env, projectStructure: structure };
  const twigOptions = makeTwigPluginOptions(env);
  const sourceFileIndex =
    env.sourceFileIndex || createSourceFileIndex(structure);

  const basePlugins = [
    virtualTwigGlobsPlugin(envWithStructure),
    virtualTwigAssetSourcesPlugin(envWithStructure),

    emulsifyTwigModulePlugin(twigOptions),

    // Generic Twig rendering for dev/preview.
    ...makeTwigPlugins(env, twigOptions),

    // Emit a physical dist/assets/icons.svg sprite.
    svgSpriteFilePlugin({
      include: [
        `${toPosixPath(projectDir)}/assets/icons/**/*.svg`,
        'assets/icons/**/*.svg',
        'src/assets/icons/**/*.svg',
        'src/**/icons/**/*.svg',
      ],
      symbolId: '[name]',
    }),

    // Sass glob imports preserve existing component stylesheet patterns.
    sassGlobImports(),

    // YAML support lets component metadata import into Vite modules.
    yamlModulePlugin(),

    // Legacy Storybook stories may still enumerate assets with require.context.
    requireContextCompatPlugin(),

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
