import { describe, expect, test } from 'bun:test';
import { AnswerCache, cyrb53 } from '../src/answer-cache.ts';
import type { Answers } from '../src/questions.ts';
import { MemoryStore } from './memory-store.ts';

const MODEL = 'typesafe/jev-1.14';
const ANSWERS: Answers = { isSlangPraise: 0.9, isPartOfName: 0, isAboutTheWord: 0.1, replacementWord: 'great' };
const STATE = { post: 'this is ⟦peak⟧' };

describe('AnswerCache', () => {
  test('survives a reload through the store', async () => {
    const store = new MemoryStore();
    const cache = await AnswerCache.load({ store, model: MODEL });

    cache.set(STATE, ANSWERS);
    await cache.flush();

    const reloaded = await AnswerCache.load({ store, model: MODEL });

    expect(reloaded.get(STATE)).toEqual(ANSWERS);
  });

  test('ignores a stored cache in an unknown format', async () => {
    const store = new MemoryStore();

    await store.write('answer-cache', { formatVersion: 999, entries: [['key', ANSWERS]] });

    const cache = await AnswerCache.load({ store, model: MODEL });

    expect(cache.size).toBe(0);
  });

  test('drops malformed stored entries and keeps the valid ones', async () => {
    const store = new MemoryStore();
    const writer = await AnswerCache.load({ store, model: MODEL });

    writer.set(STATE, ANSWERS);
    await writer.flush();

    const stored = await store.read('answer-cache');

    await store.write('answer-cache', {
      ...(typeof stored === 'object' ? stored : {}),
      entries: [
        ...(typeof stored === 'object' && stored !== null && 'entries' in stored && Array.isArray(stored.entries) ? stored.entries : []),
        ['bad-probability', { ...ANSWERS, isSlangPraise: 7 }],
        ['bad-word', { ...ANSWERS, replacementWord: 'excellent' }],
        'not-an-entry',
      ],
    });

    const reloaded = await AnswerCache.load({ store, model: MODEL });

    expect(reloaded.size).toBe(1);
    expect(reloaded.get(STATE)).toEqual(ANSWERS);
  });

  test('drops the least recently used entry once full', async () => {
    const cache = await AnswerCache.load({ store: new MemoryStore(), model: MODEL });
    const stateNumbered = (index: number) => ({ post: `post ${index} is ⟦peak⟧` });

    for (let index = 0; index < 5000; index += 1) cache.set(stateNumbered(index), ANSWERS);

    cache.get(stateNumbered(0));
    cache.set(stateNumbered(5000), ANSWERS);

    expect(cache.size).toBe(5000);
    expect(cache.get(stateNumbered(0))).toEqual(ANSWERS);
    expect(cache.get(stateNumbered(1))).toBeUndefined();
    await cache.flush();
  });

  test('keeps answers from different models and states apart', async () => {
    const store = new MemoryStore();
    const jev = await AnswerCache.load({ store, model: MODEL });
    const otherModel = await AnswerCache.load({ store, model: 'typesafe/jev-1.13' });

    jev.set(STATE, ANSWERS);

    expect(otherModel.get(STATE)).toBeUndefined();
    expect(jev.get({ post: 'this was ⟦peak⟧' })).toBeUndefined();
    expect(jev.get({ ...STATE, page_title: 'Another thread' })).toBeUndefined();
    expect(cyrb53('same')).toBe(cyrb53('same'));
    await jev.flush();
  });
});
