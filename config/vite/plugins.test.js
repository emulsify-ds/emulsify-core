/**
 * @file Tests for Emulsify Vite plugin assembly and Twig namespace behavior.
 */

import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  makePlugins,
  makeTwigNamespaces,
  makeTwigPluginOptions,
} from './plugins.js';
import { resolveProjectConfig } from './project-config.js';

jest.mock('vite-plugin-sass-glob-import', () => ({
  __esModule: true,
  default: jest.fn(() => ({ name: 'vite-plugin-sass-glob-import' })),
}));
jest.mock('@vituum/vite-plugin-twig', () => ({
  __esModule: true,
  default: jest.fn(() => [
    {
      name: '@vituum/vite-plugin-twig',
      buildStart: jest.fn(),
      buildEnd: jest.fn(),
    },
    { name: '@vituum/vite-plugin-core:bundle' },
  ]),
}));

const makeTempProject = () => mkdtempSync(join(tmpdir(), 'emulsify-core-'));

const makeEnv = (projectDir, overrides = {}) => {
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

const pluginNames = (plugins) =>
  plugins.flat(Number.POSITIVE_INFINITY).map((plugin) => plugin?.name);

const writeProjectConfig = (projectDir, config) => {
  writeFileSync(
    join(projectDir, 'project.emulsify.json'),
    JSON.stringify(config, null, 2),
  );
};

describe('Vite Twig plugins', () => {
  let projectDir;

  afterEach(() => {
    if (projectDir) {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it('builds Twig namespaces for src/components projects', () => {
    projectDir = makeTempProject();
    mkdirSync(join(projectDir, 'src/components'), { recursive: true });
    mkdirSync(join(projectDir, 'src/layout'), { recursive: true });
    mkdirSync(join(projectDir, 'src/tokens'), { recursive: true });

    expect(makeTwigNamespaces(makeEnv(projectDir))).toEqual({
      components: join(projectDir, 'src/components'),
      layout: join(projectDir, 'src/layout'),
      tokens: join(projectDir, 'src/tokens'),
    });
  });

  it('builds Twig namespaces for top-level components projects', () => {
    projectDir = makeTempProject();
    mkdirSync(join(projectDir, 'components'), { recursive: true });
    mkdirSync(join(projectDir, 'layout'), { recursive: true });
    mkdirSync(join(projectDir, 'tokens'), { recursive: true });

    expect(
      makeTwigNamespaces(
        makeEnv(projectDir, {
          srcDir: join(projectDir, 'components'),
          srcExists: false,
        }),
      ),
    ).toEqual({
      components: join(projectDir, 'components'),
      layout: join(projectDir, 'layout'),
      tokens: join(projectDir, 'tokens'),
    });
  });

  it('prefers structure override roots for component namespaces', () => {
    projectDir = makeTempProject();
    const overrideRoot = join(projectDir, 'custom/components');
    mkdirSync(overrideRoot, { recursive: true });
    mkdirSync(join(projectDir, 'src/layout'), { recursive: true });
    mkdirSync(join(projectDir, 'src/tokens'), { recursive: true });

    expect(
      makeTwigNamespaces(
        makeEnv(projectDir, {
          structureOverrides: true,
          structureRoots: [overrideRoot],
        }),
      ),
    ).toEqual({
      components: overrideRoot,
    });
  });

  it('builds Twig namespaces for multiple named structure roots', () => {
    projectDir = makeTempProject();
    writeProjectConfig(projectDir, {
      project: {
        platform: 'generic',
      },
      variant: {
        structureImplementations: [
          { name: 'components', directory: './src/components/' },
          { name: 'foundation', directory: './src/foundation/' },
          { name: 'layout', directory: './src/layout/' },
          { name: 'tokens', directory: './src/tokens/' },
        ],
      },
    });
    mkdirSync(join(projectDir, 'src/components'), { recursive: true });
    mkdirSync(join(projectDir, 'src/foundation'), { recursive: true });
    mkdirSync(join(projectDir, 'src/layout'), { recursive: true });
    mkdirSync(join(projectDir, 'src/tokens'), { recursive: true });

    expect(makeTwigNamespaces(resolveProjectConfig(projectDir, {}))).toEqual({
      components: join(projectDir, 'src/components'),
      foundation: join(projectDir, 'src/foundation'),
      layout: join(projectDir, 'src/layout'),
      tokens: join(projectDir, 'src/tokens'),
    });
  });

  it('includes the generic Vituum Twig plugin and Emulsify Twig module plugin', () => {
    projectDir = makeTempProject();
    mkdirSync(join(projectDir, 'src/components'), { recursive: true });

    expect(pluginNames(makePlugins(makeEnv(projectDir)))).toEqual(
      expect.arrayContaining([
        'emulsify-twig-module',
        '@vituum/vite-plugin-twig',
      ]),
    );
  });

  it('adds native Emulsify Twig functions to generic Twig rendering options', () => {
    projectDir = makeTempProject();
    mkdirSync(join(projectDir, 'src/components'), { recursive: true });

    expect(
      Object.keys(makeTwigPluginOptions(makeEnv(projectDir)).functions),
    ).toEqual(['add_attributes', 'bem']);
  });

  it('transforms YAML imports into JavaScript modules', () => {
    projectDir = makeTempProject();
    mkdirSync(join(projectDir, 'src/components'), { recursive: true });

    const yamlPlugin = makePlugins(makeEnv(projectDir)).find(
      (plugin) => plugin?.name === 'emulsify-yaml',
    );
    const result = yamlPlugin.transform(
      ['name: Card', 'items:', '  - one'].join('\n'),
      join(projectDir, 'src/components/card/card.component.yml'),
    );

    expect(result).toEqual({
      code: 'export default {"name":"Card","items":["one"]};\n',
      map: null,
    });
    expect(
      yamlPlugin.transform(
        'name: Raw',
        `${join(projectDir, 'src/components/card/card.component.yml')}?raw`,
      ),
    ).toBeNull();
  });

  it('keeps copy plugins for normal projects and structure overrides', () => {
    projectDir = makeTempProject();
    mkdirSync(join(projectDir, 'src/components'), { recursive: true });

    expect(pluginNames(makePlugins(makeEnv(projectDir)))).toEqual(
      expect.arrayContaining([
        'emulsify-copy-twig-files',
        'emulsify-copy-all-src-assets',
      ]),
    );

    expect(
      pluginNames(
        makePlugins(
          makeEnv(projectDir, {
            structureOverrides: true,
            structureRoots: [join(projectDir, 'src/components')],
          }),
        ),
      ),
    ).toEqual(
      expect.arrayContaining([
        'emulsify-copy-twig-files',
        'emulsify-copy-all-src-assets',
      ]),
    );
  });

  it('copies static assets from root component directories to dist/components', () => {
    projectDir = makeTempProject();
    const componentDir = join(projectDir, 'components/card');
    const outDir = join(projectDir, 'dist');
    mkdirSync(componentDir, { recursive: true });
    writeFileSync(join(componentDir, 'card.twig'), '<article></article>');
    writeFileSync(join(componentDir, '_partial.twig'), '<span></span>');
    writeFileSync(join(componentDir, 'card.component.yml'), 'name: Card');
    writeFileSync(join(componentDir, 'image.png'), 'image');
    writeFileSync(join(componentDir, 'card.js'), 'console.log("skip");');
    writeFileSync(join(componentDir, 'card.scss'), '.skip {}');

    const plugins = makePlugins(
      makeEnv(projectDir, {
        srcDir: join(projectDir, 'components'),
        srcExists: false,
      }),
    );
    const copyTwigPlugin = plugins.find(
      (plugin) => plugin?.name === 'emulsify-copy-twig-files',
    );
    const copyAssetsPlugin = plugins.find(
      (plugin) => plugin?.name === 'emulsify-copy-all-src-assets',
    );

    copyTwigPlugin.configResolved({ build: { outDir } });
    copyAssetsPlugin.configResolved({ build: { outDir } });
    copyTwigPlugin.closeBundle();
    copyAssetsPlugin.closeBundle();

    expect(existsSync(join(outDir, 'components/card/card.twig'))).toBe(true);
    expect(existsSync(join(outDir, 'components/card/_partial.twig'))).toBe(
      false,
    );
    expect(existsSync(join(outDir, 'components/card/card.component.yml'))).toBe(
      true,
    );
    expect(existsSync(join(outDir, 'components/card/image.png'))).toBe(true);
    expect(existsSync(join(outDir, 'components/card/card.js'))).toBe(false);
    expect(existsSync(join(outDir, 'components/card/card.scss'))).toBe(false);
  });

  it('copies assets from named structure roots to matching dist folders', () => {
    projectDir = makeTempProject();
    const outDir = join(projectDir, 'dist');
    writeProjectConfig(projectDir, {
      project: {
        platform: 'generic',
      },
      variant: {
        structureImplementations: [
          { name: 'components', directory: './src/components/' },
          { name: 'foundation', directory: './src/foundation/' },
        ],
      },
    });
    mkdirSync(join(projectDir, 'src/components/card'), { recursive: true });
    mkdirSync(join(projectDir, 'src/foundation/icons'), { recursive: true });
    writeFileSync(
      join(projectDir, 'src/components/card/card.twig'),
      '<article></article>',
    );
    writeFileSync(
      join(projectDir, 'src/components/card/_partial.twig'),
      '<span></span>',
    );
    writeFileSync(
      join(projectDir, 'src/components/card/card.component.yml'),
      'name: Card',
    );
    writeFileSync(join(projectDir, 'src/components/card/image.png'), 'image');
    writeFileSync(join(projectDir, 'src/foundation/icons/icon.svg'), '<svg />');
    writeFileSync(
      join(projectDir, 'src/foundation/icons/_partial.twig'),
      '<span></span>',
    );
    writeFileSync(
      join(projectDir, 'src/foundation/icons/icon.component.json'),
      '{"name":"Icon"}',
    );

    const plugins = makePlugins(resolveProjectConfig(projectDir, {}));
    const copyTwigPlugin = plugins.find(
      (plugin) => plugin?.name === 'emulsify-copy-twig-files',
    );
    const copyAssetsPlugin = plugins.find(
      (plugin) => plugin?.name === 'emulsify-copy-all-src-assets',
    );

    copyTwigPlugin.configResolved({ build: { outDir } });
    copyAssetsPlugin.configResolved({ build: { outDir } });
    copyTwigPlugin.closeBundle();
    copyAssetsPlugin.closeBundle();

    expect(existsSync(join(outDir, 'components/card/card.twig'))).toBe(true);
    expect(existsSync(join(outDir, 'components/card/_partial.twig'))).toBe(
      false,
    );
    expect(existsSync(join(outDir, 'components/card/card.component.yml'))).toBe(
      true,
    );
    expect(existsSync(join(outDir, 'components/card/image.png'))).toBe(true);
    expect(existsSync(join(outDir, 'foundation/icons/icon.svg'))).toBe(true);
    expect(existsSync(join(outDir, 'foundation/icons/_partial.twig'))).toBe(
      false,
    );
    expect(
      existsSync(join(outDir, 'foundation/icons/icon.component.json')),
    ).toBe(true);
  });

  it('only enables Drupal component mirroring for Drupal projects with src', () => {
    projectDir = makeTempProject();
    const distComponentFile = join(
      projectDir,
      'dist/components/card/card.twig',
    );
    const rootComponentFile = join(projectDir, 'components/card/card.twig');

    const genericMirror = makePlugins(makeEnv(projectDir)).find(
      (plugin) => plugin?.name === 'emulsify-mirror-components-to-root',
    );
    const drupalMirror = makePlugins(
      makeEnv(projectDir, { platform: 'drupal' }),
    ).find((plugin) => plugin?.name === 'emulsify-mirror-components-to-root');
    const legacyDrupalMirror = makePlugins(
      makeEnv(projectDir, {
        platform: 'drupal',
        srcExists: false,
      }),
    ).find((plugin) => plugin?.name === 'emulsify-mirror-components-to-root');

    mkdirSync(join(projectDir, 'dist/components/card'), { recursive: true });
    writeFileSync(distComponentFile, '<article>{{ title }}</article>');
    genericMirror.configResolved({
      build: { outDir: join(projectDir, 'dist') },
    });
    expect(genericMirror.closeBundle()).toBeUndefined();
    expect(existsSync(distComponentFile)).toBe(true);
    expect(existsSync(rootComponentFile)).toBe(false);

    drupalMirror.configResolved({
      build: { outDir: join(projectDir, 'dist') },
    });
    expect(drupalMirror.closeBundle()).toBeUndefined();
    expect(existsSync(distComponentFile)).toBe(false);
    expect(existsSync(rootComponentFile)).toBe(true);

    mkdirSync(join(projectDir, 'dist/components/card'), { recursive: true });
    writeFileSync(distComponentFile, '<article>{{ title }}</article>');
    utimesSync(
      rootComponentFile,
      new Date('2000-01-01T00:00:00Z'),
      new Date('2000-01-01T00:00:00Z'),
    );
    const rootMtimeBefore = statSync(rootComponentFile).mtimeMs;
    expect(drupalMirror.closeBundle()).toBeUndefined();
    expect(existsSync(distComponentFile)).toBe(false);
    expect(statSync(rootComponentFile).mtimeMs).toBe(rootMtimeBefore);

    rmSync(join(projectDir, 'components'), { recursive: true, force: true });
    mkdirSync(join(projectDir, 'dist/components/card'), { recursive: true });
    writeFileSync(distComponentFile, '<article>{{ title }}</article>');
    legacyDrupalMirror.configResolved({
      build: { outDir: join(projectDir, 'dist') },
    });
    expect(legacyDrupalMirror.closeBundle()).toBeUndefined();
    expect(existsSync(distComponentFile)).toBe(true);
    expect(existsSync(rootComponentFile)).toBe(false);
  });
});
