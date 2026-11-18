import { isAnswers, questions, type Answers, type DecisionState } from './questions.ts';

export interface KeyValueStore {
  read(key: string): Promise<unknown>;
  write(key: string, value: unknown): Promise<void>;
}

const STORAGE_KEY = 'answer-cache';
const STORAGE_FORMAT_VERSION = 1;
const MAXIMUM_ENTRIES = 5000;
const PERSIST_DELAY_MILLISECONDS = 1000;

interface StoredCache {
  formatVersion: number;
  entries: [string, Answers][];
}

const isStoredEntry = (value: unknown): value is [string, Answers] =>
  Array.isArray(value) && value.length === 2 && typeof value[0] === 'string' && isAnswers(value[1]);

const parseStoredEntries = (stored: unknown): [string, Answers][] => {
  if (typeof stored !== 'object' || stored === null) return [];

  if (!('formatVersion' in stored) || stored.formatVersion !== STORAGE_FORMAT_VERSION) return [];

  if (!('entries' in stored) || !Array.isArray(stored.entries)) return [];

  return stored.entries.filter(isStoredEntry);
};

export const cyrb53 = (text: string): string => {
  let first = 0xdeadbeef;
  let second = 0x41c6ce57;

  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);

    first = Math.imul(first ^ code, 2654435761);
    second = Math.imul(second ^ code, 1597334677);
  }

  first = Math.imul(first ^ (first >>> 16), 2246822507) ^ Math.imul(second ^ (second >>> 13), 3266489909);
  second = Math.imul(second ^ (second >>> 16), 2246822507) ^ Math.imul(first ^ (first >>> 13), 3266489909);

  return (4294967296 * (2097151 & second) + (first >>> 0)).toString(36);
};

const QUESTION_SET_FINGERPRINT = cyrb53(JSON.stringify(questions));

export class AnswerCache {
  private entries = new Map<string, Answers>();
  private persistTimer: ReturnType<typeof setTimeout> | undefined;

  private constructor(
    private readonly store: KeyValueStore,
    private readonly model: string,
  ) {}

  static async load({ store, model }: { store: KeyValueStore; model: string }): Promise<AnswerCache> {
    const cache = new AnswerCache(store, model);
    const stored = await store.read(STORAGE_KEY).catch(() => undefined);

    cache.entries = new Map(parseStoredEntries(stored));

    return cache;
  }

  get(state: DecisionState): Answers | undefined {
    const key = this.keyFor(state);
    const answers = this.entries.get(key);

    if (answers === undefined) return undefined;

    this.entries.delete(key);
    this.entries.set(key, answers);

    return answers;
  }

  set(state: DecisionState, answers: Answers): void {
    const key = this.keyFor(state);

    this.entries.delete(key);
    this.entries.set(key, answers);
    this.evictLeastRecentlyUsed();
    this.schedulePersist();
  }

  get size(): number {
    return this.entries.size;
  }

  async flush(): Promise<void> {
    clearTimeout(this.persistTimer);

    this.persistTimer = undefined;

    const stored: StoredCache = { formatVersion: STORAGE_FORMAT_VERSION, entries: [...this.entries] };

    await this.store.write(STORAGE_KEY, stored);
  }

  private keyFor(state: DecisionState): string {
    return cyrb53(`${QUESTION_SET_FINGERPRINT}\u0000${this.model}\u0000${JSON.stringify(state)}`);
  }

  private evictLeastRecentlyUsed(): void {
    for (const key of this.entries.keys()) {
      if (this.entries.size <= MAXIMUM_ENTRIES) return;

      this.entries.delete(key);
    }
  }

  private schedulePersist(): void {
    if (this.persistTimer !== undefined) return;

    this.persistTimer = setTimeout(() => {
      this.flush().catch((error) => console.warn('[peak-replacer] Could not save the answer cache.', error));
    }, PERSIST_DELAY_MILLISECONDS);
  }
}
