/**
 * @file Shared test helpers for Vite plugin unit tests.
 */

import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Twig from 'twig';

import { registerTwigExtensions } from '../../../src/extensions/twig/index.js';

/**
 * Create an isolated temporary project directory for plugin tests.
 *
 * @returns {string} Absolute temporary project path.
 */
export const makeTempProject = () =>
  mkdtempSync(join(tmpdir(), 'emulsify-core-'));

/**
 * Build the minimum Emulsify environment object required by Vite plugins.
 *
 * @param {string} projectDir - Absolute project root.
 * @param {object} [overrides={}] - Environment values to override.
 * @returns {object} Test environment object.
 */
export const makeEnv = (projectDir, overrides = {}) => {
  const srcDir = join(projectDir, 'src');

  // Tests override only the environment values relevant to each scenario.
  return {
    projectDir,
    srcDir,
    srcExists: true,
    platform: 'generic',
    structureOverrides: false,
    structureRoots: [],
    ...overrides,
  };
};

/**
 * Flatten plugin arrays and return their plugin names.
 *
 * @param {Array} plugins - Vite plugin array, including nested arrays.
 * @returns {Array<string|undefined>} Plugin names.
 */
export const pluginNames = (plugins) =>
  plugins.flat(Number.POSITIVE_INFINITY).map((plugin) => plugin?.name);

/**
 * Run a Twig transform with the minimal Vite transform context used in tests.
 *
 * @param {object} plugin - Twig module plugin.
 * @param {string} filePath - Absolute Twig file path.
 * @returns {object|null} Transform result.
 */
export const transformTwigModule = (plugin, filePath) =>
  plugin.transform.call({ addWatchFile: jest.fn() }, '', filePath);

/**
 * Create a Twig include statement for a literal template path.
 *
 * @param {string} templatePath - Template path to include.
 * @returns {string} Twig include statement.
 */
export const twigInclude = (templatePath) =>
  `{% include ${JSON.stringify(templatePath)} %}`;

/**
 * Create a Twig embed statement for a literal template path.
 *
 * @param {string} templatePath - Template path to embed.
 * @returns {string} Twig embed statement opener.
 */
export const twigEmbed = (templatePath) =>
  `{% embed ${JSON.stringify(templatePath)} %}`;

/**
 * Normalize the Twig runtime supplied to generated-module tests.
 *
 * The generated module imports `factory` from Twig. Tests can pass a concrete
 * Twig instance, a factory function, or an object with a `factory` method.
 *
 * @param {Function|object} runtimeTwigOrOptions - Runtime Twig override.
 * @returns {Function} Twig factory function.
 */
const generatedTwigFactory = (runtimeTwigOrOptions) => {
  if (typeof runtimeTwigOrOptions === 'function') {
    return runtimeTwigOrOptions;
  }
  if (typeof runtimeTwigOrOptions?.factory === 'function') {
    return runtimeTwigOrOptions.factory;
  }
  if (runtimeTwigOrOptions) {
    return () => runtimeTwigOrOptions;
  }
  return () => Twig.factory();
};

/**
 * Evaluate generated Twig module source and return its default render function.
 *
 * @param {string} code - Generated ESM module source.
 * @param {Function|object} runtimeTwigOrOptions - Runtime Twig override.
 * @returns {Function} Generated render function.
 */
export const createGeneratedTwigModuleRender = (code, runtimeTwigOrOptions) => {
  const executable = code
    .replace(/^\s*import (?:Twig|\{ factory \}) from 'twig';\s*/m, '')
    .replace(
      /^\s*import \{ registerTwigExtensions \} from '@emulsify\/core\/extensions\/twig';\s*/m,
      '',
    )
    .replace(
      /export default \(context = \{\}\) => \{/,
      'return (context = {}) => {',
    );
  const render = new Function('factory', 'registerTwigExtensions', executable)(
    generatedTwigFactory(runtimeTwigOrOptions),
    registerTwigExtensions,
  );

  return render;
};

/**
 * Render generated Twig module source with a context object.
 *
 * @param {string} code - Generated ESM module source.
 * @param {object} [context={}] - Twig render context.
 * @param {Function|object} runtimeTwigOrOptions - Runtime Twig override.
 * @returns {string} Rendered HTML.
 */
export const renderGeneratedTwigModule = (
  code,
  context = {},
  runtimeTwigOrOptions,
) => createGeneratedTwigModuleRender(code, runtimeTwigOrOptions)(context);

/**
 * Write a project.emulsify.json fixture into a temporary project.
 *
 * @param {string} projectDir - Absolute temporary project path.
 * @param {object} config - Project configuration fixture.
 * @returns {void}
 */
export const writeProjectConfig = (projectDir, config) => {
  writeFileSync(
    join(projectDir, 'project.emulsify.json'),
    JSON.stringify(config, null, 2),
  );
};
