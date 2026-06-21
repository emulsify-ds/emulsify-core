/**
 * @file Tests for shared project structure resolution.
 */

import { mkdtempSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  resetProjectStructureCache,
  resolveProjectStructure,
} from './project-structure.js';

const makeTempProject = () => mkdtempSync(join(tmpdir(), 'emulsify-core-'));

describe('resolveProjectStructure', () => {
  const projectDirs = [];

  beforeEach(() => {
    resetProjectStructureCache();
  });

  afterEach(() => {
    for (const projectDir of projectDirs) {
      rmSync(projectDir, { recursive: true, force: true });
    }
    projectDirs.length = 0;
    resetProjectStructureCache();
  });

  const makeEnv = () => {
    const projectDir = makeTempProject();
    projectDirs.push(projectDir);
    mkdirSync(join(projectDir, 'src/components'), { recursive: true });

    return {
      projectDir,
      srcDir: join(projectDir, 'src'),
      srcExists: true,
    };
  };

  it('memoizes the resolved structure for the same env object', () => {
    const env = makeEnv();
    const first = resolveProjectStructure(env);
    const second = resolveProjectStructure(env);

    expect(second).toBe(first);
  });

  it('keeps different env objects independent', () => {
    const firstEnv = makeEnv();
    const first = resolveProjectStructure(firstEnv);
    const firstProjectDir = firstEnv.projectDir;
    const secondEnv = makeEnv();
    const second = resolveProjectStructure(secondEnv);

    expect(second).not.toBe(first);
    expect(first.componentRoots).toEqual([
      join(firstProjectDir, 'src/components'),
    ]);
    expect(second.componentRoots).toEqual([
      join(secondEnv.projectDir, 'src/components'),
    ]);
  });

  it('memoizes the default environment fallback', () => {
    const first = resolveProjectStructure();
    const second = resolveProjectStructure();

    expect(second).toBe(first);
  });

  it('includes normalized asset roots in the project structure model', () => {
    const env = makeEnv();
    env.assetRoots = ['./src/assets', join(env.projectDir, 'design/assets')];

    const structure = resolveProjectStructure(env);

    expect(structure.assetRoots).toEqual([
      join(env.projectDir, 'src/assets'),
      join(env.projectDir, 'design/assets'),
    ]);
  });

  it('ignores unsafe asset roots in the project structure model', () => {
    const env = makeEnv();
    env.assetRoots = [
      '../shared-assets',
      '/tmp/outside-assets',
      './src/assets',
      './src/assets',
    ];

    const structure = resolveProjectStructure(env);

    expect(structure.assetRoots).toEqual([join(env.projectDir, 'src/assets')]);
  });
});
