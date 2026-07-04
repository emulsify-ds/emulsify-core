/**
 * @file Tests for browser-safe root-relative path utilities.
 */

import { toRootRelativePath } from './root-relative.js';

describe('root-relative path utilities', () => {
  it.each([
    ['/project/', '/project/src/components', '/src/components'],
    ['/project//', '/project//src//components//', '/src/components'],
    [
      'C:\\project\\theme',
      'C:\\project\\theme\\src\\components',
      '/src/components',
    ],
    ['/project', '/project', '/'],
    ['/project', '/other/src/components', '/other/src/components'],
  ])('normalizes %s and %s to %s', (projectDir, absolutePath, expected) => {
    expect(toRootRelativePath(projectDir, absolutePath)).toBe(expected);
  });
});
