/**
 * @file Tests for shared uniqueness utilities.
 */

import { unique, uniqueBy } from './unique.js';

describe('unique utilities', () => {
  it('returns first-seen unique values without dropping falsey values', () => {
    expect(unique(['a', 'b', 'a', '', '', 0, 0, false, false])).toEqual([
      'a',
      'b',
      '',
      0,
      false,
    ]);
  });

  it('deduplicates values by a computed key', () => {
    const values = [
      { name: 'card', path: 'src/components/card' },
      { name: 'button', path: 'src/components/button' },
      { name: 'card', path: 'components/card' },
    ];

    expect(uniqueBy(values, (value) => value.name)).toEqual([
      values[0],
      values[1],
    ]);
  });
});
