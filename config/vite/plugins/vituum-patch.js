/**
 * @file Vituum Twig plugin adapter for Emulsify Vite builds.
 *
 * Emulsify keeps Vituum's Twig rendering, middleware, and reload behavior while
 * removing incompatible page-entry rename hooks from Vite build output.
 */

import twig from '@vituum/vite-plugin-twig';
import Twig from 'twig';

import { registerTwigExtensions } from '../../../src/extensions/twig/index.js';
import { makeTwigPluginOptions } from './twig-module.js';

/**
 * Instantiate Vituum's Twig renderer without its entry-renaming build hooks.
 *
 * @param {Parameters<typeof makeTwigPluginOptions>[0]} env - Project environment.
 * @param {ReturnType<typeof makeTwigPluginOptions>} [options] - Twig plugin options.
 * @returns {import('vite').PluginOption[]} Vituum Twig plugin options.
 */
export function makeTwigPlugins(env, options = makeTwigPluginOptions(env)) {
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
