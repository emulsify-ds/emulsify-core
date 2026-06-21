/**
 * @file Tests for normalized Emulsify project configuration.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  resetProjectConfigCache,
  resolveProjectConfig,
} from './project-config.js';

const makeTempProject = () => mkdtempSync(join(tmpdir(), 'emulsify-core-'));

const writeProjectConfig = (projectDir, config) => {
  writeFileSync(
    join(projectDir, 'project.emulsify.json'),
    JSON.stringify(config, null, 2),
  );
};

describe('resolveProjectConfig', () => {
  let projectDir;

  beforeEach(() => {
    resetProjectConfigCache();
  });

  afterEach(() => {
    if (projectDir) {
      rmSync(projectDir, { recursive: true, force: true });
    }
    resetProjectConfigCache();
  });

  it('normalizes Drupal project config with SDC enabled', () => {
    projectDir = makeTempProject();
    mkdirSync(join(projectDir, 'src/components'), { recursive: true });
    writeProjectConfig(projectDir, {
      project: {
        platform: 'drupal',
        name: 'whisk',
        machineName: 'whisk',
        singleDirectoryComponents: true,
      },
    });

    const env = resolveProjectConfig(projectDir, {});

    expect(env).toMatchObject({
      projectDir,
      platform: 'drupal',
      machineName: 'whisk',
      srcExists: true,
      srcDir: join(projectDir, 'src'),
      singleDirectoryComponents: true,
      SDC: true,
      structureOverrides: false,
      outputStrategy: 'drupal-sdc',
      outputMode: 'drupal-sdc',
    });
    expect(env.componentRoots).toEqual([join(projectDir, 'src/components')]);
    expect(env.namespaceRoots.components).toBe(
      join(projectDir, 'src/components'),
    );
    expect(env.projectStructure).toMatchObject({
      componentRoots: [join(projectDir, 'src/components')],
      globalRoots: [join(projectDir, 'src')],
      storyRoots: [join(projectDir, 'src')],
      mirrorComponentOutput: true,
    });
    expect(env.platformAdapter).toMatchObject({
      name: 'drupal',
      storybook: {
        loadDrupalBehaviorShim: true,
        attachDrupalBehaviors: true,
        registerDrupalTwigFilters: true,
      },
      build: {
        mirrorDistComponentsToRoot: true,
      },
    });
  });

  it('normalizes none project config without platform-specific behavior', () => {
    projectDir = makeTempProject();
    mkdirSync(join(projectDir, 'components'), { recursive: true });
    writeProjectConfig(projectDir, {
      project: {
        platform: 'none',
        name: 'starter',
        machineName: 'starter',
      },
    });

    const env = resolveProjectConfig(projectDir, {});

    expect(env).toMatchObject({
      platform: 'none',
      machineName: 'starter',
      srcExists: false,
      srcDir: join(projectDir, 'components'),
      singleDirectoryComponents: false,
      SDC: false,
      outputStrategy: 'dist',
    });
    expect(env.platformAdapter).toMatchObject({
      name: 'none',
      storybook: {
        loadDrupalBehaviorShim: false,
        attachDrupalBehaviors: false,
        registerDrupalTwigFilters: false,
      },
      build: {
        mirrorDistComponentsToRoot: false,
      },
    });
    expect(env.projectStructure).toMatchObject({
      componentRoots: [join(projectDir, 'components')],
      globalRoots: [],
      storyRoots: [join(projectDir, 'components')],
      mirrorComponentOutput: false,
    });
  });

  it('supports legacy generic platform config as none', () => {
    projectDir = makeTempProject();
    mkdirSync(join(projectDir, 'components'), { recursive: true });
    writeProjectConfig(projectDir, {
      project: {
        platform: 'generic',
      },
    });

    const env = resolveProjectConfig(projectDir, {});

    expect(env.platform).toBe('none');
    expect(env.platformAdapter.name).toBe('none');
    expect(env.platformAdapter.build.mirrorDistComponentsToRoot).toBe(false);
  });

  it('normalizes multiple named variant structure implementations', () => {
    projectDir = makeTempProject();
    for (const directory of [
      'src/components',
      'src/foundation',
      'src/layout',
      'src/tokens',
    ]) {
      mkdirSync(join(projectDir, directory), { recursive: true });
    }
    writeProjectConfig(projectDir, {
      project: {
        platform: 'drupal',
        name: 'emulsify-ui-kit',
        machineName: 'emulsify-ui-kit',
      },
      variant: {
        platform: 'drupal',
        structureImplementations: [
          { name: 'components', directory: './src/components/' },
          { name: 'foundation', directory: './src/foundation/' },
          { name: 'layout', directory: './src/layout/' },
          { name: 'tokens', directory: './src/tokens/' },
        ],
      },
    });

    const env = resolveProjectConfig(projectDir, {});
    const expectedRoots = [
      join(projectDir, 'src/components'),
      join(projectDir, 'src/foundation'),
      join(projectDir, 'src/layout'),
      join(projectDir, 'src/tokens'),
    ];

    expect(env.structureOverrides).toBe(true);
    expect(env.structureImplementations).toEqual([
      { name: 'components', directory: expectedRoots[0] },
      { name: 'foundation', directory: expectedRoots[1] },
      { name: 'layout', directory: expectedRoots[2] },
      { name: 'tokens', directory: expectedRoots[3] },
    ]);
    expect(env.structureRoots).toEqual(expectedRoots);
    expect(env.componentRoots).toEqual(expectedRoots);
    expect(env.namespaceRoots).toEqual({
      components: expectedRoots[0],
      foundation: expectedRoots[1],
      layout: expectedRoots[2],
      tokens: expectedRoots[3],
    });
    expect(env.projectStructure.storyRoots).toEqual(expectedRoots);
  });

  it('memoizes normalized config for the same project and env', () => {
    projectDir = makeTempProject();
    mkdirSync(join(projectDir, 'src/components'), { recursive: true });

    const first = resolveProjectConfig(projectDir, {});
    const second = resolveProjectConfig(projectDir, {});

    expect(second).toBe(first);
  });

  it('lets EMULSIFY_PLATFORM override project and variant platform config', () => {
    projectDir = makeTempProject();
    writeProjectConfig(projectDir, {
      project: {
        platform: 'drupal',
        machineName: 'override-test',
      },
      variant: {
        platform: 'drupal',
      },
    });

    const env = resolveProjectConfig(projectDir, {
      EMULSIFY_PLATFORM: 'none',
    });

    expect(env.platform).toBe('none');
    expect(env.platformAdapter.name).toBe('none');
    expect(env.platformAdapter.build.mirrorDistComponentsToRoot).toBe(false);
  });

  it('supports legacy generic platform env override as none', () => {
    projectDir = makeTempProject();
    writeProjectConfig(projectDir, {
      project: {
        platform: 'drupal',
      },
    });

    const env = resolveProjectConfig(projectDir, {
      EMULSIFY_PLATFORM: 'generic',
    });

    expect(env.platform).toBe('none');
    expect(env.platformAdapter.name).toBe('none');
  });

  it('does not share cache entries between explicit none overrides and project defaults', () => {
    projectDir = makeTempProject();
    writeProjectConfig(projectDir, {
      project: {
        platform: 'drupal',
      },
    });

    const overridden = resolveProjectConfig(projectDir, {
      EMULSIFY_PLATFORM: 'generic',
    });
    const fromProjectConfig = resolveProjectConfig(projectDir, {});

    expect(overridden.platform).toBe('none');
    expect(fromProjectConfig.platform).toBe('drupal');
  });

  it('ignores unsafe structure implementation paths', () => {
    projectDir = makeTempProject();
    mkdirSync(join(projectDir, 'src/components'), { recursive: true });
    writeProjectConfig(projectDir, {
      project: {
        platform: 'none',
      },
      variant: {
        structureImplementations: [
          { name: 'unsafeRelative', directory: '../outside' },
          { name: 'unsafeAbsolute', directory: '/tmp/outside' },
          { name: 'components', directory: './src/components' },
        ],
      },
    });

    const env = resolveProjectConfig(projectDir, {});

    expect(env.structureImplementations).toEqual([
      {
        name: 'components',
        directory: join(projectDir, 'src/components'),
      },
    ]);
    expect(env.structureRoots).toEqual([join(projectDir, 'src/components')]);
    expect(env.namespaceRoots).toEqual({
      components: join(projectDir, 'src/components'),
    });
  });

  it('normalizes documented assets.roots into project structure asset roots', () => {
    projectDir = makeTempProject();
    mkdirSync(join(projectDir, 'design-system/assets'), {
      recursive: true,
    });
    mkdirSync(join(projectDir, 'prototype-assets'), { recursive: true });
    writeProjectConfig(projectDir, {
      project: {
        platform: 'none',
      },
      assets: {
        roots: ['./design-system/assets/', './prototype-assets'],
      },
    });

    const env = resolveProjectConfig(projectDir, {});
    const expectedRoots = [
      join(projectDir, 'design-system/assets'),
      join(projectDir, 'prototype-assets'),
    ];

    expect(env.assetRoots).toEqual(expectedRoots);
    expect(env.projectStructure.assetRoots).toEqual(expectedRoots);
  });

  it('ignores unsafe asset root paths', () => {
    projectDir = makeTempProject();
    mkdirSync(join(projectDir, 'src/assets'), { recursive: true });
    writeProjectConfig(projectDir, {
      project: {
        platform: 'none',
      },
      assets: {
        roots: [
          '../shared-assets',
          '/tmp/outside-assets',
          './src/assets',
          './src/assets',
          '',
          42,
        ],
      },
    });

    const env = resolveProjectConfig(projectDir, {});

    expect(env.assetRoots).toEqual([join(projectDir, 'src/assets')]);
    expect(env.projectStructure.assetRoots).toEqual([
      join(projectDir, 'src/assets'),
    ]);
  });
});
