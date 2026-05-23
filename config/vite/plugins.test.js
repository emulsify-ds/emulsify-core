import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  makePlugins,
  makeTwigNamespaces,
  makeTwigPluginOptions,
} from './plugins.js';

jest.mock('vite-plugin-sass-glob-import', () => ({
  __esModule: true,
  default: jest.fn(() => ({ name: 'vite-plugin-sass-glob-import' })),
}));
jest.mock('@modyfi/vite-plugin-yaml', () => ({
  __esModule: true,
  default: jest.fn(() => ({ name: '@modyfi/vite-plugin-yaml' })),
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

  it('keeps copy plugins for normal projects and omits them for structure overrides', () => {
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
      expect.not.arrayContaining([
        'emulsify-copy-twig-files',
        'emulsify-copy-all-src-assets',
      ]),
    );
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
