/**
 * @file Tests for shared path utilities.
 */

import { sep } from 'path';
import { replaceLastSlash, toPosix, toPosixPath } from './paths.js';

describe('Vite path utilities', () => {
  it('normalizes host separators to POSIX separators', () => {
    expect(toPosix(['src', 'components', 'button'].join(sep))).toBe(
      'src/components/button',
    );
  });

  it('normalizes Windows separators on any host', () => {
    expect(toPosix('src\\components\\button')).toBe('src/components/button');
    expect(toPosixPath('C:\\theme\\src\\components')).toBe(
      'C:/theme/src/components',
    );
  });

  it('replaces the final slash with a bucket segment', () => {
    expect(replaceLastSlash('components/card/card', '/css/')).toBe(
      'components/card/css/card',
    );
  });

  it('leaves slashless paths unchanged when replacing the final slash', () => {
    expect(replaceLastSlash('card', '/css/')).toBe('card');
  });
});
