/**
 * @file Integration tests for the public Vite plugins barrel.
 */

import { existsSync, lstatSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';

import * as pluginsModule from './plugins.js';
import { createDiagnosticsCollector } from './plugins/reporter/diagnostics.js';
import { hasCycleFailure } from './plugins/reporter/render.js';
import { makeEnv, makeTempProject, pluginNames } from './test-utils/plugins.js';

jest.mock('@mlnop/vite-plugin-sass-glob-import', () => ({
  __esModule: true,
  default: jest.fn(() => ({ name: 'sass-glob-import' })),
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
    jest.restoreAllMocks();
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
        'sass-glob-import',
        'emulsify-yaml',
        'emulsify-require-context-compat',
        'emulsify-css-asset-url-relativizer',
        'emulsify-stable-watch-output',
        'emulsify-copy-twig-files',
        'emulsify-copy-all-src-assets',
        'emulsify-mirror-components-to-root',
      ]),
    );
    expect(names).not.toContain('@vituum/vite-plugin-core:bundle');
  });

  it('omits the develop reporter unless a diagnostics collector is supplied', () => {
    projectDir = makeTempProject();

    // Direct consumers that omit diagnostics must not get a reporter with no
    // collector to summarize.
    expect(
      pluginNames(pluginsModule.makePlugins(makeEnv(projectDir))),
    ).not.toContain('emulsify-develop-reporter');

    const withDiagnostics = pluginsModule.makePlugins({
      ...makeEnv(projectDir),
      diagnostics: createDiagnosticsCollector(),
    });

    expect(pluginNames(withDiagnostics)).toContain('emulsify-develop-reporter');
    expect(
      withDiagnostics.find(
        (plugin) => plugin?.name === 'emulsify-develop-reporter',
      ).apply,
    ).toBe('build');
  });

  it('only enables root component mirroring for Drupal projects with src', () => {
    projectDir = makeTempProject();
    const distComponentFile = join(
      projectDir,
      'dist/components/card/card.twig',
    );
    const rootComponentFile = join(projectDir, 'components/card/card.twig');

    const noneMirror = pluginsModule
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
    noneMirror.configResolved({
      build: { outDir: join(projectDir, 'dist') },
    });
    expect(noneMirror.writeBundle()).toBeUndefined();
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

  it('fails the cycle when the Drupal component mirror cannot publish a file', () => {
    projectDir = makeTempProject();
    const outDir = join(projectDir, 'dist');
    const distComponentFile = join(outDir, 'components/ghost/same.twig');
    const rootComponentFile = join(projectDir, 'components/ghost/same.twig');
    const diagnostics = createDiagnosticsCollector();
    const plugins = pluginsModule.makePlugins({
      ...makeEnv(projectDir, { platform: 'drupal' }),
      diagnostics,
    });
    const mirror = plugins.find(
      (plugin) => plugin?.name === 'emulsify-mirror-components-to-root',
    );
    const warn = jest.fn();
    const consoleWarn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => {});

    mkdirSync(join(distComponentFile, '..'), { recursive: true });
    writeFileSync(distComponentFile, 'new template bytes');
    // A directory at the file destination reproduces the EISDIR mirror wedge.
    mkdirSync(rootComponentFile, { recursive: true });

    mirror.configResolved({ build: { outDir } });
    expect(mirror.writeBundle.call({ warn })).toBeUndefined();

    const snapshot = diagnostics.snapshot();
    expect(existsSync(distComponentFile)).toBe(true);
    expect(lstatSync(rootComponentFile).isDirectory()).toBe(true);
    expect(snapshot.errors).toEqual([
      expect.objectContaining({
        file: rootComponentFile,
        message: expect.stringMatching(
          /Mirror copy failed for .*components[/\\]ghost[/\\]same\.twig/,
        ),
        outputState: 'incomplete',
      }),
    ]);
    expect(hasCycleFailure(snapshot)).toBe(true);
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/Mirror copy failed.*same\.twig/),
    );
    expect(consoleWarn).not.toHaveBeenCalled();
  });

  it('shares copied-file writes with the detailed reporter', () => {
    projectDir = makeTempProject();
    const sourceFile = join(projectDir, 'src/components/card/card.twig');
    const outDir = join(projectDir, 'dist');
    const diagnostics = createDiagnosticsCollector();
    const previousVerbosity = process.env.EMULSIFY_VERBOSE;
    process.env.EMULSIFY_VERBOSE = '2';

    try {
      mkdirSync(join(sourceFile, '..'), { recursive: true });
      writeFileSync(sourceFile, 'first template bytes');
      const plugins = pluginsModule.makePlugins({
        ...makeEnv(projectDir),
        diagnostics,
      });
      const copyTwig = plugins.find(
        (plugin) => plugin?.name === 'emulsify-copy-twig-files',
      );
      const reporter = plugins.find(
        (plugin) => plugin?.name === 'emulsify-develop-reporter',
      );
      const stdoutWrite = jest
        .spyOn(process.stdout, 'write')
        .mockImplementation(() => true);
      const config = {
        root: projectDir,
        build: {
          outDir,
          watch: {},
          rollupOptions: { input: {} },
        },
      };
      const bundle = { 'base.css': { type: 'asset', source: 'same' } };

      copyTwig.configResolved(config);
      reporter.configResolved(config);
      stdoutWrite.mockClear();

      reporter.buildStart();
      copyTwig.writeBundle();
      reporter.writeBundle.handler({}, bundle);
      stdoutWrite.mockClear();

      writeFileSync(sourceFile, 'second template bytes');
      reporter.buildStart();
      copyTwig.writeBundle();
      reporter.writeBundle.handler({}, bundle);

      const output = stdoutWrite.mock.calls
        .map(([line]) => String(line))
        .join('');
      expect(output).toContain('1 output changed');
      expect(output).toContain('components/card/card.twig');
      expect(output).not.toContain('no output changed');
    } finally {
      if (previousVerbosity === undefined) {
        delete process.env.EMULSIFY_VERBOSE;
      } else {
        process.env.EMULSIFY_VERBOSE = previousVerbosity;
      }
    }
  });
});
