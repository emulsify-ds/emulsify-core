/**
 * @file Public barrel for Emulsify Vite plugin helpers.
 *
 * This file preserves the `@emulsify/core/vite/plugins` export path while the
 * implementation lives in focused internal modules under `config/vite/plugins/`.
 */

export { makePlugins } from './plugins/index.js';
export {
  makeTwigNamespaces,
  makeTwigPluginOptions,
} from './plugins/twig-module.js';
