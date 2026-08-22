/**
 * LRU Cache implementation using a Map (insertion-order LRU).
 *
 * Strategy: on access (get/set), the entry is moved to the most-recently-used
 * position by deleting and re-inserting it. The least-recently-used entry is
 * always at the front — Map.keys().next().value — and is evicted when the cache
 * reaches capacity.
 */

export interface LRUCache<K, V> {
  get(key: K): V | undefined;
  set(key: K, value: V): void;
  has(key: K): boolean;
  clear(): void;
  readonly size: number;
}

export function createLRUCache<K, V>(capacity: number): LRUCache<K, V> {
  // Map preserves insertion order; we move accessed entries to the end.
  // Oldest (LRU) is at the front — Map.keys().next().value.
  const map = new Map<K, V>();

  return {
    get(key: K): V | undefined {
      if (!map.has(key)) return undefined;
      const value = map.get(key)!;
      // Move to most-recently-used position (end of Map)
      map.delete(key);
      map.set(key, value);
      return value;
    },

    set(key: K, value: V): void {
      if (map.has(key)) {
        // Re-insert at end to mark as most-recently-used
        map.delete(key);
      } else if (map.size >= capacity) {
        // Evict LRU entry (first key = oldest)
        map.delete(map.keys().next().value as K);
      }
      map.set(key, value);
    },

    has(key: K): boolean {
      return map.has(key);
    },

    clear(): void {
      map.clear();
    },

    get size(): number {
      return map.size;
    },
  };
}
