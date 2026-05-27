/**
 * @file Tests for shared source file indexing helpers.
 */

import fs from 'fs';
import { join } from 'path';

import { makeTempProject } from '../../test-utils/plugins.js';
import { walkFiles } from '../source-file-index.js';

describe('source file index helpers', () => {
  let projectDir;

  afterEach(() => {
    if (projectDir) {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
    jest.restoreAllMocks();
  });

  it('uses dirents, skips default heavy directories, and supports opt-out traversal', () => {
    projectDir = makeTempProject();
    const sourceDir = join(projectDir, 'src');
    const componentDir = join(sourceDir, 'components');
    const nodeModulesDir = join(sourceDir, 'node_modules/fake-package');
    fs.mkdirSync(componentDir, { recursive: true });
    fs.mkdirSync(nodeModulesDir, { recursive: true });

    for (let i = 0; i < 1000; i += 1) {
      fs.writeFileSync(join(componentDir, `component-${i}.twig`), '');
    }

    for (let i = 0; i < 10000; i += 1) {
      fs.writeFileSync(join(nodeModulesDir, `dependency-${i}.js`), '');
    }

    const statSpy = jest.spyOn(fs, 'statSync');
    const defaultFiles = walkFiles(sourceDir);
    const allFiles = walkFiles(sourceDir, { useDefaultSkips: false });

    expect(statSpy).not.toHaveBeenCalled();
    expect(defaultFiles).toHaveLength(1000);
    expect(
      defaultFiles.every((filePath) => !filePath.includes('node_modules')),
    ).toBe(true);
    expect(allFiles).toHaveLength(11000);
    expect(allFiles.some((filePath) => filePath.includes('node_modules'))).toBe(
      true,
    );
  });
});
