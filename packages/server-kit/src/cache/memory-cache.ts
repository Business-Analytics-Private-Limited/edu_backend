/**
 * A small in-process cache with expiry (ADR-0014).
 *
 * Used for answers that are asked on every request but change rarely, such as "is the
 * students module enabled for this tenant?". Entries expire after `ttlMs`, and the code that
 * changes the data calls invalidate() so this process sees the change at once.
 *
 * Other API processes only see a change after the expiry. That is fine while the API runs as
 * one process; before running several, this is replaced by a Redis-backed implementation of
 * the same interface.
 *
 *   const cache = new MemoryCache<boolean>(60_000);
 *   const enabled = await cache.getOrLoad(`${tenantId}:students`, () => loadFromDatabase());
 *   cache.invalidate((key) => key.startsWith(`${tenantId}:`));
 */
export interface Cache<V> {
  getOrLoad(key: string, load: () => Promise<V>): Promise<V>;
  /** Drops one key, or every key matching a test. */
  invalidate(keyOrTest: string | ((key: string) => boolean)): void;
}

export class MemoryCache<V> implements Cache<V> {
  private readonly entries = new Map<string, { value: V; expiresAt: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 10_000,
    private readonly now: () => number = Date.now,
  ) {}

  async getOrLoad(key: string, load: () => Promise<V>): Promise<V> {
    const hit = this.entries.get(key);
    if (hit && hit.expiresAt > this.now()) return hit.value;

    const value = await load();
    // Simple size limit: forget the oldest entry (Maps keep insertion order).
    if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
    return value;
  }

  invalidate(keyOrTest: string | ((key: string) => boolean)): void {
    if (typeof keyOrTest === 'string') {
      this.entries.delete(keyOrTest);
      return;
    }
    for (const key of [...this.entries.keys()]) {
      if (keyOrTest(key)) this.entries.delete(key);
    }
  }
}
