/**
 * @file Tests for Twig reference path helpers.
 */

import {
  buildTwigRootRecords,
  resetTwigRootRecordsCache,
  toRootRelativePath,
} from './reference-paths.js';
import { twigGlobPatterns } from '../../../config/vite/plugins/virtual-twig-globs.js';

const makeEnv = (projectDir, rootName = 'components') => ({
  projectDir,
  projectStructure: {
    componentRootRecords: [
      { name: rootName, directory: `${projectDir}/src/${rootName}` },
    ],
    namespaceRoots: {
      [rootName]: `${projectDir}/src/${rootName}`,
    },
  },
});

describe('Twig reference path helpers', () => {
  beforeEach(() => {
    resetTwigRootRecordsCache();
  });

  it('memoizes Twig root records for the same env object', () => {
    const env = makeEnv('/project');

    expect(buildTwigRootRecords(env)).toBe(buildTwigRootRecords(env));
  });

  it('keeps Twig root record caches independent for different env objects', () => {
    const firstEnv = makeEnv('/first');
    const secondEnv = makeEnv('/second', 'foundation');
    const firstRecords = buildTwigRootRecords(firstEnv);
    const secondRecords = buildTwigRootRecords(secondEnv);

    expect(firstRecords).not.toBe(secondRecords);
    expect(firstRecords).toContainEqual({
      name: 'components',
      directory: '/first/src/components',
      rootRel: '/src/components',
    });
    expect(secondRecords).toContainEqual({
      name: 'foundation',
      directory: '/second/src/foundation',
      rootRel: '/src/foundation',
    });
  });

  it.each([
    {
      label: 'trailing project slash',
      projectDir: '/project/',
      absolutePath: '/project/src/components',
      expectedRoot: '/src/components',
    },
    {
      label: 'double slashes',
      projectDir: '/project//',
      absolutePath: '/project//src//components//',
      expectedRoot: '/src/components',
    },
    {
      label: 'Windows backslashes',
      projectDir: 'C:\\project\\theme',
      absolutePath: 'C:\\project\\theme\\src\\components',
      expectedRoot: '/src/components',
    },
    {
      label: 'project root',
      projectDir: '/project',
      absolutePath: '/project',
      expectedRoot: '/',
    },
    {
      label: 'outside project root',
      projectDir: '/project',
      absolutePath: '/other/src/components',
      expectedRoot: '/other/src/components',
    },
  ])(
    'uses one key algorithm for template IDs and glob keys: $label',
    ({ projectDir, absolutePath, expectedRoot }) => {
      const env = {
        projectDir,
        projectStructure: {
          twigRoots: [absolutePath],
        },
      };
      const [globPattern] = twigGlobPatterns(env);
      const globRoot =
        globPattern === '/**/*.twig'
          ? '/'
          : globPattern.replace(/\/\*\*\/\*\.twig$/, '');

      expect(toRootRelativePath(absolutePath, env)).toBe(expectedRoot);
      expect(globRoot).toBe(expectedRoot);
    },
  );
});
