/**
 * @file Integration tests for the public Vite plugins barrel.
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';

import * as pluginsModule from './plugins.js';
import { makeEnv, makeTempProject, pluginNames } from './test-utils/plugins.js';

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

describe('Vite plugin public barrel', () => {
  let projectDir;

  afterEach(() => {
    if (projectDir) {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it('preserves the public export list', () => {
    expect(Object.keys(pluginsModule).sort()).toEqual([
      'makePlugins',
      'makeTwigNamespaces',
      'makeTwigPluginOptions',
    ]);
  });

  it('composes the Emulsify plugin chain end-to-end', () => {
    projectDir = makeTempProject();
    mkdirSync(join(projectDir, 'src/components'), { recursive: true });

    const names = pluginNames(pluginsModule.makePlugins(makeEnv(projectDir)));

    expect(names).toEqual(
      expect.arrayContaining([
        'emulsify-virtual-twig-globs',
        'emulsify-virtual-twig-asset-sources',
        'emulsify-twig-module',
        '@vituum/vite-plugin-twig',
        'emulsify-svg-sprite-file',
        'vite-plugin-sass-glob-import',
        'emulsify-yaml',
        'emulsify-require-context-compat',
        'emulsify-css-asset-url-relativizer',
        'emulsify-copy-twig-files',
        'emulsify-copy-all-src-assets',
        'emulsify-mirror-components-to-root',
      ]),
    );
    expect(names).not.toContain('@vituum/vite-plugin-core:bundle');
  });

  it('only enables root component mirroring for Drupal projects with src', () => {
    projectDir = makeTempProject();
    const distComponentFile = join(
      projectDir,
      'dist/components/card/card.twig',
    );
    const rootComponentFile = join(projectDir, 'components/card/card.twig');

    const genericMirror = pluginsModule
      .makePlugins(makeEnv(projectDir))
      .find((plugin) => plugin?.name === 'emulsify-mirror-components-to-root');
    const drupalMirror = pluginsModule
      .makePlugins(makeEnv(projectDir, { platform: 'drupal' }))
      .find((plugin) => plugin?.name === 'emulsify-mirror-components-to-root');
    const legacyDrupalMirror = pluginsModule
      .makePlugins(
        makeEnv(projectDir, {
          platform: 'drupal',
          srcExists: false,
        }),
      )
      .find((plugin) => plugin?.name === 'emulsify-mirror-components-to-root');

    mkdirSync(join(projectDir, 'dist/components/card'), { recursive: true });
    writeFileSync(distComponentFile, '<article>{{ title }}</article>');
    genericMirror.configResolved({
      build: { outDir: join(projectDir, 'dist') },
    });
    expect(genericMirror.writeBundle()).toBeUndefined();
    expect(existsSync(distComponentFile)).toBe(true);
    expect(existsSync(rootComponentFile)).toBe(false);

    drupalMirror.configResolved({
      build: { outDir: join(projectDir, 'dist') },
    });
    expect(drupalMirror.writeBundle()).toBeUndefined();
    expect(existsSync(distComponentFile)).toBe(false);
    expect(existsSync(rootComponentFile)).toBe(true);

    rmSync(join(projectDir, 'components'), { recursive: true, force: true });
    mkdirSync(join(projectDir, 'dist/components/card'), { recursive: true });
    writeFileSync(distComponentFile, '<article>{{ title }}</article>');
    legacyDrupalMirror.configResolved({
      build: { outDir: join(projectDir, 'dist') },
    });
    expect(legacyDrupalMirror.writeBundle()).toBeUndefined();
    expect(existsSync(distComponentFile)).toBe(true);
    expect(existsSync(rootComponentFile)).toBe(false);
  });
});
