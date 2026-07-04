/**
 * @file Tiny Map-like LRU cache helper.
 */

/**
 * Create a bounded insertion-order LRU cache.
 *
 * @template K,V
 * @param {number} maxEntries - Maximum number of entries to retain.
 * @returns {{
 *   readonly size: number,
 *   has(key: K): boolean,
 *   get(key: K): V|undefined,
 *   set(key: K, value: V): object,
 *   delete(key: K): boolean,
 *   clear(): void,
 *   entries(): IterableIterator<[K, V]>,
 *   keys(): IterableIterator<K>,
 *   values(): IterableIterator<V>,
 *   [Symbol.iterator](): IterableIterator<[K, V]>
 * }} Map-like LRU cache.
 */
export function createLruCache(maxEntries) {
  if (!Number.isInteger(maxEntries) || maxEntries < 1) {
    throw new RangeError('LRU cache size must be a positive integer.');
  }

  const entries = new Map();
  const cache = {
    get size() {
      return entries.size;
    },
    has(key) {
      return entries.has(key);
    },
    get(key) {
      if (!entries.has(key)) return undefined;

      const value = entries.get(key);
      entries.delete(key);
      entries.set(key, value);
      return value;
    },
    set(key, value) {
      if (entries.has(key)) {
        entries.delete(key);
      }
      entries.set(key, value);

      while (entries.size > maxEntries) {
        entries.delete(entries.keys().next().value);
      }

      return cache;
    },
    delete(key) {
      return entries.delete(key);
    },
    clear() {
      entries.clear();
    },
    entries() {
      return entries.entries();
    },
    keys() {
      return entries.keys();
    },
    values() {
      return entries.values();
    },
    [Symbol.iterator]() {
      return entries[Symbol.iterator]();
    },
  };

  return cache;
}
