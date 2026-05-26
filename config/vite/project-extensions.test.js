/**
 * @file Tests for project-level Vite extension loading.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawnSync } from 'child_process';
import { pathToFileURL } from 'url';

import { loadProjectExtensions } from './project-extensions.js';

const makeTempProject = () => mkdtempSync(join(tmpdir(), 'emulsify-core-'));

const extensionDir = (projectDir) =>
  join(projectDir, 'config/emulsify-core/vite');

const writeExtension = (projectDir, fileName, source) => {
  const dir = extensionDir(projectDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, fileName), source);
};

const loadExtensions = (projectDir, env = {}) =>
  loadProjectExtensions({
    env: {
      projectDir,
      machineName: 'fixture-project',
      ...env,
    },
  });

const loadExtensionsWithNativeNode = (projectDir, env, resultExpression) => {
  const loaderUrl = pathToFileURL(
    join(process.cwd(), 'config/vite/project-extensions.js'),
  ).href;
  const projectEnv = {
    projectDir,
    ...env,
  };
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
import { loadProjectExtensions } from ${JSON.stringify(loaderUrl)};

const result = await loadProjectExtensions({ env: ${JSON.stringify(projectEnv)} });
console.log(JSON.stringify(${resultExpression}));
`,
    ],
    { encoding: 'utf8' },
  );

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout);
  }

  return JSON.parse(result.stdout);
};

describe('loadProjectExtensions', () => {
  let projectDir;

  beforeEach(() => {
    projectDir = makeTempProject();
  });

  afterEach(() => {
    if (projectDir) {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it('loads and uses config/emulsify-core/vite/plugins.js from the project root', async () => {
    writeExtension(
      projectDir,
      'plugins.js',
      `
module.exports = [
  {
    name: 'project-js-plugin',
    config() {
      return { define: { __PROJECT_JS_PLUGIN__: JSON.stringify(true) } };
    },
  },
];
`,
    );

    const { projectPlugins } = await loadExtensions(projectDir);

    expect(projectPlugins).toHaveLength(1);
    expect(projectPlugins[0].name).toBe('project-js-plugin');
    expect(projectPlugins[0].config()).toEqual({
      define: { __PROJECT_JS_PLUGIN__: 'true' },
    });
  });

  it('passes env to ESM default plugin factories', async () => {
    writeExtension(
      projectDir,
      'plugins.mjs',
      `
export default ({ env }) => [
  {
    name: \`project-factory-\${env.machineName}\`,
  },
];
`,
    );

    const projectPlugins = loadExtensionsWithNativeNode(
      projectDir,
      { machineName: 'env-aware' },
      'result.projectPlugins',
    );

    expect(projectPlugins).toEqual([{ name: 'project-factory-env-aware' }]);
  });

  it('supports ESM config/emulsify-core/vite/plugins.js in module projects', async () => {
    writeFileSync(
      join(projectDir, 'package.json'),
      JSON.stringify({ type: 'module' }),
    );
    writeExtension(
      projectDir,
      'plugins.js',
      `
export default [
  {
    name: 'project-esm-js-plugin',
  },
];
`,
    );

    const projectPlugins = loadExtensionsWithNativeNode(
      projectDir,
      { machineName: 'esm-js' },
      'result.projectPlugins',
    );

    expect(projectPlugins).toEqual([{ name: 'project-esm-js-plugin' }]);
  });

  it('supports CommonJS module exports', async () => {
    writeExtension(
      projectDir,
      'plugins.cjs',
      `
module.exports = [{ name: 'project-cjs-module-export' }];
`,
    );

    const { projectPlugins } = await loadExtensions(projectDir);

    expect(projectPlugins).toEqual([{ name: 'project-cjs-module-export' }]);
  });

  it('supports CommonJS default exports', async () => {
    writeExtension(
      projectDir,
      'plugins.cjs',
      `
exports.default = ({ env }) => [
  {
    name: \`project-cjs-default-\${env.machineName}\`,
  },
];
`,
    );

    const { projectPlugins } = await loadExtensions(projectDir, {
      machineName: 'default-export',
    });

    expect(projectPlugins).toEqual([
      { name: 'project-cjs-default-default-export' },
    ]);
  });

  it('loads named extendConfig exports', async () => {
    writeExtension(
      projectDir,
      'plugins.mjs',
      `
export const extendConfig = (config, { env }) => ({
  define: {
    __BASE__: JSON.stringify(config.base),
    __PROJECT_NAME__: JSON.stringify(env.machineName),
  },
});
`,
    );

    const result = loadExtensionsWithNativeNode(
      projectDir,
      { machineName: 'extended-project' },
      `{
        projectPlugins: result.projectPlugins,
        extended: result.extendConfig({ base: '/storybook/' }, {
          env: { machineName: 'extended-project' },
        }),
      }`,
    );

    expect(result.projectPlugins).toEqual([]);
    expect(result.extended).toEqual({
      define: {
        __BASE__: '"/storybook/"',
        __PROJECT_NAME__: '"extended-project"',
      },
    });
  });

  it('returns empty extensions when no public project extension file exists', async () => {
    const { projectPlugins, extendConfig } = await loadExtensions(projectDir);

    expect(projectPlugins).toEqual([]);
    expect(extendConfig).toBeUndefined();
  });
});
