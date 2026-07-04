/**
 * @file Tests for Twig reference path helpers.
 */

import {
  buildTwigRootRecords,
  resetTwigRootRecordsCache,
} from './reference-paths.js';

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
});
