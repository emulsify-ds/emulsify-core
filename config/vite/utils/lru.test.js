/**
 * @file Tests for the tiny LRU cache helper.
 */

import { createLruCache } from './lru.js';

describe('LRU cache utility', () => {
  it('evicts the least recently used entry when capped', () => {
    const cache = createLruCache(2);

    cache.set('first', 1);
    cache.set('second', 2);
    cache.get('first');
    cache.set('third', 3);

    expect(cache.has('first')).toBe(true);
    expect(cache.has('second')).toBe(false);
    expect(cache.has('third')).toBe(true);
    expect(Array.from(cache.keys())).toEqual(['first', 'third']);
  });

  it('refreshes insertion order when an existing entry is set', () => {
    const cache = createLruCache(2);

    cache.set('first', 1);
    cache.set('second', 2);
    cache.set('first', 3);
    cache.set('third', 4);

    expect(Array.from(cache.entries())).toEqual([
      ['first', 3],
      ['third', 4],
    ]);
  });

  it('supports delete and clear', () => {
    const cache = createLruCache(2);

    cache.set('first', 1);
    cache.set('second', 2);

    expect(cache.delete('first')).toBe(true);
    expect(cache.delete('missing')).toBe(false);
    expect(Array.from(cache.values())).toEqual([2]);

    cache.clear();

    expect(cache.size).toBe(0);
    expect(Array.from(cache)).toEqual([]);
  });
});
