/**
 * @file Shared test helpers for Vite plugin unit tests.
 */

import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Twig from 'twig';

import { registerTwigExtensions } from '../../../src/extensions/twig/index.js';

export const makeTempProject = () =>
  mkdtempSync(join(tmpdir(), 'emulsify-core-'));

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

export const pluginNames = (plugins) =>
  plugins.flat(Number.POSITIVE_INFINITY).map((plugin) => plugin?.name);

export const transformTwigModule = (plugin, filePath) =>
  plugin.transform.call({ addWatchFile: jest.fn() }, '', filePath);

export const twigInclude = (templatePath) =>
  `{% include ${JSON.stringify(templatePath)} %}`;

export const twigEmbed = (templatePath) =>
  `{% embed ${JSON.stringify(templatePath)} %}`;

export const createGeneratedTwigModuleRender = (
  code,
  runtimeTwig = Twig.factory(),
) => {
  const executable = code
    .replace(/^\s*import Twig from 'twig';\s*/m, '')
    .replace(
      /^\s*import \{ registerTwigExtensions \} from '@emulsify\/core\/extensions\/twig';\s*/m,
      '',
    )
    .replace(
      /export default \(context = \{\}\) => \{/,
      'return (context = {}) => {',
    );
  const render = new Function('Twig', 'registerTwigExtensions', executable)(
    runtimeTwig,
    registerTwigExtensions,
  );

  return render;
};

export const renderGeneratedTwigModule = (
  code,
  context = {},
  runtimeTwig = Twig.factory(),
) => createGeneratedTwigModuleRender(code, runtimeTwig)(context);

export const writeProjectConfig = (projectDir, config) => {
  writeFileSync(
    join(projectDir, 'project.emulsify.json'),
    JSON.stringify(config, null, 2),
  );
};
