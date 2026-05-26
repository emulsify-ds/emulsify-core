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

const EXPECTED_PLUGIN_NAMES = [
  '@vituum/vite-plugin-core:bundle',
  '@vituum/vite-plugin-twig',
];
const EXPECTED_HOOKS_TO_STRIP = ['buildStart', 'buildEnd'];
const VITUUM_TWIG_PLUGIN_NAME = '@vituum/vite-plugin-twig';
const SHAPE_CHANGE_GUIDANCE =
  'Pin @vituum/vite-plugin-twig to a known-good version or update vituum-patch.js.';

/**
 * Inspect Vituum plugin output before patching so shape changes fail loudly.
 *
 * @param {import('vite').PluginOption[]} plugins - Normalized Vituum plugins.
 * @returns {{
 *   detectedPluginNames: string[],
 *   foundPluginNames: Set<string>,
 *   twigHooksPresent: Set<string>
 * }} Detected plugin shape details.
 */
function inspectVituumPluginShape(plugins) {
  const detectedPluginNames = [];
  const foundPluginNames = new Set();
  const twigHooksPresent = new Set();

  for (const pluginOption of plugins) {
    const pluginName = pluginOption?.name;
    detectedPluginNames.push(pluginName || '<unnamed>');

    if (EXPECTED_PLUGIN_NAMES.includes(pluginName)) {
      foundPluginNames.add(pluginName);
    }

    if (pluginName === VITUUM_TWIG_PLUGIN_NAME) {
      for (const hookName of EXPECTED_HOOKS_TO_STRIP) {
        if (hookName in pluginOption) {
          twigHooksPresent.add(hookName);
        }
      }
    }
  }

  return { detectedPluginNames, foundPluginNames, twigHooksPresent };
}

/**
 * Format plugin names for shape-change diagnostics.
 *
 * @param {string[]} pluginNames - Plugin names to report.
 * @returns {string} JSON-formatted plugin list.
 */
function formatPluginNames(pluginNames) {
  return JSON.stringify(pluginNames);
}

/**
 * Assert Vituum exposed the plugin names and hooks Emulsify patches.
 *
 * @param {ReturnType<typeof inspectVituumPluginShape>} shape - Detected shape.
 */
function assertExpectedVituumShape(shape) {
  const missingPluginNames = EXPECTED_PLUGIN_NAMES.filter(
    (pluginName) => !shape.foundPluginNames.has(pluginName),
  );

  if (missingPluginNames.length) {
    throw new Error(
      [
        `Vituum plugin shape changed: expected ${missingPluginNames
          .map((pluginName) => `'${pluginName}'`)
          .join(', ')} not found.`,
        `Detected plugins: ${formatPluginNames(shape.detectedPluginNames)}.`,
        SHAPE_CHANGE_GUIDANCE,
      ].join(' '),
    );
  }

  if (!shape.twigHooksPresent.size) {
    throw new Error(
      [
        `Vituum plugin shape changed: '${VITUUM_TWIG_PLUGIN_NAME}' did not expose any targeted hooks to strip.`,
        `Expected at least one of: ${formatPluginNames(EXPECTED_HOOKS_TO_STRIP)}.`,
        `Detected plugins: ${formatPluginNames(shape.detectedPluginNames)}.`,
        SHAPE_CHANGE_GUIDANCE,
      ].join(' '),
    );
  }
}

/**
 * Assert stripped Vituum hooks are absent after patching.
 *
 * @param {import('vite').PluginOption} pluginOption - Patched plugin.
 */
function assertHooksStripped(pluginOption) {
  const remainingHooks = EXPECTED_HOOKS_TO_STRIP.filter(
    (hookName) => hookName in pluginOption,
  );

  if (remainingHooks.length) {
    throw new Error(
      [
        `Vituum plugin patch failed: '${VITUUM_TWIG_PLUGIN_NAME}' still exposes targeted hooks after stripping.`,
        `Remaining hooks: ${formatPluginNames(remainingHooks)}.`,
        SHAPE_CHANGE_GUIDANCE,
      ].join(' '),
    );
  }
}

/**
 * Strip the Vituum hooks that conflict with Emulsify build output.
 *
 * @param {import('vite').PluginOption} pluginOption - Cloned Twig plugin.
 */
function stripExpectedHooks(pluginOption) {
  delete pluginOption.buildStart;
  delete pluginOption.buildEnd;
}

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
  const normalizedPlugins = Array.isArray(twigPlugins)
    ? twigPlugins
    : [twigPlugins];
  const shape = inspectVituumPluginShape(normalizedPlugins);
  assertExpectedVituumShape(shape);

  return normalizedPlugins
    .filter(
      (pluginOption) =>
        pluginOption?.name !== '@vituum/vite-plugin-core:bundle',
    )
    .map((pluginOption) => {
      if (pluginOption?.name !== '@vituum/vite-plugin-twig') {
        return pluginOption;
      }

      const renderPlugin = { ...pluginOption };
      stripExpectedHooks(renderPlugin);
      assertHooksStripped(renderPlugin);
      return renderPlugin;
    });
}
