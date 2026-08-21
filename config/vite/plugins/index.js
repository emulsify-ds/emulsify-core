/**
 * @file Vite plugin composition for Emulsify.
 *
 * Assembles the shared plugin chain used by Vite and Storybook while delegating
 * each individual plugin concern to focused internal modules.
 */

import sassGlobImports from '@mlnop/vite-plugin-sass-glob-import';

import { getPlatformAdapter } from '../platforms.js';
import { resolveProjectStructure } from '../project-structure.js';
import { toPosixPath } from '../utils/paths.js';
import { copyAllSrcAssetsPlugin } from './assets/copy-src-assets.js';
import { copyTwigFilesPlugin } from './assets/copy-twig-files.js';
import { cssAssetRebasePlugin } from './assets/css-asset-rebase.js';
import { cssAssetUrlRelativizer } from './assets/css-asset-relativizer.js';
import { mirrorComponentsToRoot } from './assets/mirror-components.js';
import { createSourceFileIndex } from './assets/source-file-index.js';
import { stableWatchOutputPlugin } from './assets/stable-watch-output.js';
import { svgSpriteFilePlugin } from './assets/svg-sprite.js';
import { developReporterPlugin } from './reporter/index.js';
import { requireContextCompatPlugin } from './require-context.js';
import { virtualTwigExtensionInstallersPlugin } from './twig/extension-installers.js';
import {
  emulsifyTwigModulePlugin,
  makeTwigPluginOptions,
} from './twig/twig-module.js';
import { virtualTwigAssetSourcesPlugin } from './twig/virtual-twig-asset-sources.js';
import { virtualTwigGlobsPlugin } from './twig/virtual-twig-globs.js';
import { makeTwigPlugins } from './twig/vituum-patch.js';
import { yamlModulePlugin } from './yaml-module.js';

/**
 * Create the Vite plugin array used by Emulsify builds.
 *
 * @param {{
 *   projectDir: string,
 *   platform: string,
 *   srcDir: string,
 *   srcExists: boolean,
 *   structureOverrides?: boolean,
 *   diagnostics?: object
 * }} env - Project environment. When `diagnostics` is present the reporter is
 *   appended for watch summaries and actionable one-shot diagnostics.
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

  // In lean-output mode, filled by the rebase plugin and read by the
  // relativizer: published asset path -> where that file actually lives,
  // relative to the project root. It stays empty for self-contained output.
  /** @type {Map<string, string>} */
  const publishedAssetSources = new Map();
  // The subset above that came from Vite copies. An actual CSS rewrite plus
  // membership here authorizes the relativizer to remove a redundant copy.
  /** @type {Set<string>} */
  const removablePublishedAssets = new Set();

  // Filled by the stable-output plugin, read by the reporter: emitted files it
  // dropped this cycle because the bytes on disk already match. The reporter
  // diffs one cycle's bundle against the last, so without this a skipped file
  // would be listed as a deleted one.
  /** @type {Set<string>} */
  const unchangedOutputs = new Set();

  const basePlugins = [
    virtualTwigExtensionInstallersPlugin(envWithStructure),
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

    // Repair CSS asset URLs Vite could not resolve. Ordering against the
    // relativizer below is load-bearing: this normalizes URLs to `/assets/...`
    // and either emits an output asset or records its source-tree location;
    // only then can the relativizer select and calculate the final target.
    cssAssetRebasePlugin({
      env: envWithStructure,
      diagnostics: env.diagnostics,
      publishedAssetSources,
      removablePublishedAssets,
    }),

    // Point CSS asset URLs at the file each one names, relative to the
    // stylesheet's own location on disk.
    cssAssetUrlRelativizer({
      assetsRoot: 'assets',
      env: envWithStructure,
      publishedAssetSources,
      removablePublishedAssets,
    }),

    // Last of the CSS chain: once the text is final, an unchanged stylesheet is
    // dropped rather than rewritten, so a watch rebuild does not send HMR
    // updates for stylesheets the edit never touched.
    stableWatchOutputPlugin({
      projectDir,
      mirrorComponentOutput: structure.mirrorComponentOutput,
      unchangedOutputs,
    }),
  ];

  return [
    ...basePlugins,

    // Copy Twig templates and component metadata beside compiled assets.
    copyTwigFilesPlugin({
      structure,
      sourceFileIndex,
      diagnostics: env.diagnostics,
    }),

    // Copy every non-code asset under src with the same routing.
    copyAllSrcAssetsPlugin({
      structure,
      sourceFileIndex,
      diagnostics: env.diagnostics,
    }),

    // Drupal projects with src mirror dist/components back to ./components.
    mirrorComponentsToRoot({
      enabled: structure.mirrorComponentOutput,
      projectDir,
    }),

    // Summarize `npm run develop`, and report actionable diagnostics collected
    // during one-shot Vite or Storybook builds.
    ...(env.diagnostics
      ? [
          developReporterPlugin({
            env,
            diagnostics: env.diagnostics,
            unchangedOutputs,
          }),
        ]
      : []),
  ];
}
