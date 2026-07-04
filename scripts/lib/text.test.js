/**
 * @file Tests for shared text helpers.
 */

import { lineNumberAt } from './text.js';

describe('script text helpers', () => {
  it('returns a 1-based line number for a character index', () => {
    const source = ['first', 'second', 'third'].join('\n');

    expect(lineNumberAt(source, 0)).toBe(1);
    expect(lineNumberAt(source, source.indexOf('second'))).toBe(2);
    expect(lineNumberAt(source, source.indexOf('third'))).toBe(3);
  });
});
