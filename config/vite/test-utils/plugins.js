/**
 * @file Shared test helpers for Vite plugin unit tests.
 */

import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Twig from 'twig';

import { registerTwigExtensions } from '../../../src/extensions/twig/index.js';
import { createTwigIncludeFunction } from '../../../src/storybook/twig/include-function.js';
import { createTwigSourceFunction } from '../../../src/storybook/twig/source-function.js';

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
    platform: 'none',
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

const generatedTwigDependencyModules = new Map();
const generatedTwigDependencyImportsByCode = new Map();
const generatedTwigDependencyImportPattern =
  /^\s*import \{ templateId as ([A-Za-z_$][\w$]*), templateParams as ([A-Za-z_$][\w$]*) \} from ['"]([^'"]+)['"];\s*/gm;

const evaluateGeneratedTwigDependencyModule = (source) => {
  const exports = {};
  const executable = source.replace(
    /export const ([A-Za-z_$][\w$]*) =/g,
    'exports.$1 =',
  );

  new Function('exports', executable)(exports);
  return exports;
};

const collectGeneratedTwigDependencyImports = (code) => {
  const imports = [];

  for (const match of code.matchAll(generatedTwigDependencyImportPattern)) {
    const [, templateIdVariable, templateParamsVariable, moduleId] = match;
    imports.push({ templateIdVariable, templateParamsVariable, moduleId });
  }

  return imports;
};

const registerGeneratedTwigDependencyModules = (plugin, code) => {
  if (!code || typeof plugin?.resolveId !== 'function') {
    return;
  }

  const imports = collectGeneratedTwigDependencyImports(code);
  if (!imports.length) {
    return;
  }

  const resolvedImports = imports.map((dependencyImport) => {
    const resolvedId = plugin.resolveId(dependencyImport.moduleId);
    const moduleId = resolvedId || dependencyImport.moduleId;
    const source =
      typeof plugin.load === 'function'
        ? plugin.load.call({ addWatchFile: jest.fn() }, moduleId)
        : '';
    const cachedModule = generatedTwigDependencyModules.get(moduleId);

    if (!cachedModule || cachedModule.source !== source) {
      generatedTwigDependencyModules.set(moduleId, {
        source,
        exports: evaluateGeneratedTwigDependencyModule(source),
      });
    }

    return {
      ...dependencyImport,
      exports: generatedTwigDependencyModules.get(moduleId).exports,
    };
  });

  generatedTwigDependencyImportsByCode.set(code, resolvedImports);
};

/**
 * Run a Twig transform with the minimal Vite transform context used in tests.
 *
 * @param {object} plugin - Twig module plugin.
 * @param {string} filePath - Absolute Twig file path.
 * @returns {object|null} Transform result.
 */
export const transformTwigModule = (plugin, filePath) => {
  const result = plugin.transform.call(
    { addWatchFile: jest.fn() },
    '',
    filePath,
  );
  registerGeneratedTwigDependencyModules(plugin, result?.code);
  return result;
};

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
  const installProjectTwigExtensions =
    typeof runtimeTwigOrOptions?.installProjectTwigExtensions === 'function'
      ? runtimeTwigOrOptions.installProjectTwigExtensions
      : () => {};
  const dependencyImports =
    generatedTwigDependencyImportsByCode.get(code) || [];
  const executable = code
    .replace(generatedTwigDependencyImportPattern, '')
    .replace(/^\s*import (?:Twig|\{ factory \}) from 'twig';\s*/m, '')
    .replace(
      /^\s*import \{ registerTwigExtensions \} from '@emulsify\/core\/extensions\/twig';\s*/m,
      '',
    )
    .replace(
      /^\s*import \{ installProjectTwigExtensions \} from 'virtual:emulsify-twig-extension-installers';\s*/m,
      '',
    )
    .replace(
      /^\s*import \{ createTwigIncludeFunction \} from '@emulsify\/core\/storybook\/twig\/include-function';\s*/m,
      '',
    )
    .replace(
      /^\s*import \{ createTwigSourceFunction \} from '@emulsify\/core\/storybook\/twig\/source-function';\s*/m,
      '',
    )
    .replace(
      /export default \(context = \{\}\) => \{/,
      'return (context = {}) => {',
    );
  const render = new Function(
    'factory',
    'registerTwigExtensions',
    'installProjectTwigExtensions',
    'createTwigIncludeFunction',
    'createTwigSourceFunction',
    ...dependencyImports.flatMap(
      ({ templateIdVariable, templateParamsVariable }) => [
        templateIdVariable,
        templateParamsVariable,
      ],
    ),
    executable,
  )(
    generatedTwigFactory(runtimeTwigOrOptions),
    registerTwigExtensions,
    installProjectTwigExtensions,
    createTwigIncludeFunction,
    createTwigSourceFunction,
    ...dependencyImports.flatMap(({ exports }) => [
      exports.templateId,
      exports.templateParams,
    ]),
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
