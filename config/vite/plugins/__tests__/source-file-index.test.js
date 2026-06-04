/**
 * @file Tests for shared source file indexing helpers.
 */

import fs from 'fs';
import { join } from 'path';

import { makeTempProject } from '../../test-utils/plugins.js';
import { createSourceFileIndex, walkFiles } from '../source-file-index.js';

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

  it('returns the same component file array reference between calls', () => {
    projectDir = makeTempProject();
    const componentRoot = join(projectDir, 'src/components');
    const globalRoot = join(projectDir, 'src');
    fs.mkdirSync(join(componentRoot, 'card'), { recursive: true });
    fs.mkdirSync(join(globalRoot, 'templates'), { recursive: true });
    fs.writeFileSync(join(componentRoot, 'card/card.twig'), '<article />');
    fs.writeFileSync(join(globalRoot, 'templates/page.twig'), '<main />');

    const index = createSourceFileIndex({
      componentRootRecords: [{ directory: componentRoot }],
      globalRootRecords: [{ directory: globalRoot }],
    });
    const firstComponentFiles = index.componentFiles();
    const secondComponentFiles = index.componentFiles();

    expect(secondComponentFiles).toBe(firstComponentFiles);
    expect(firstComponentFiles).toHaveLength(1);
    expect(index.globalFiles()).toHaveLength(1);
    expect(index.all()).toHaveLength(2);
  });
});
