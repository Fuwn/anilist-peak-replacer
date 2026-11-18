import type { KeyValueStore } from '../src/answer-cache.ts';

export class MemoryStore implements KeyValueStore {
  readonly values = new Map<string, string>();
  writeCount = 0;

  async read(key: string): Promise<unknown> {
    const raw = this.values.get(key);

    return raw === undefined ? undefined : JSON.parse(raw);
  }

  async write(key: string, value: unknown): Promise<void> {
    this.writeCount += 1;

    this.values.set(key, JSON.stringify(value));
  }
}
