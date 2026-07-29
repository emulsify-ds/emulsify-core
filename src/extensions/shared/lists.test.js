/**
 * @file Tests for list coercion utilities.
 */

import { flattenList, unique } from './lists.js';

describe('list utilities', () => {
  it('flattens nested list values without dropping 0 or empty strings', () => {
    expect(flattenList(['a', ['b', [0, '', false, null, undefined]]])).toEqual([
      'a',
      'b',
      0,
      '',
    ]);
  });

  it('returns first-seen unique values without dropping falsey values', () => {
    expect(unique(['a', 'b', 'a', '', '', 0, 0, false, false])).toEqual([
      'a',
      'b',
      '',
      0,
      false,
    ]);
  });
});
