import { describe, expect, test } from 'bun:test';
import { AnswerCache } from '../src/answer-cache.ts';
import { createDecider } from '../src/decider.ts';
import { DecisionsHttpError, TransportError, type Classification, type Classify } from '../src/decisions-client.ts';
import type { Answers } from '../src/questions.ts';
import { MemoryStore } from './memory-store.ts';

const MODEL = 'typesafe/jev-1.14';

const classificationOf = (answers: Partial<Answers>): Classification => ({
  answers: { isSlangPraise: 0.95, isPartOfName: 0.01, isAboutTheWord: 0.02, replacementWord: 'great', ...answers },
  model: MODEL,
  usage: { costDollars: 0, inputTokens: 0 },
});

const deciderWith = async (classify: Classify) => {
  const cache = await AnswerCache.load({ store: new MemoryStore(), model: MODEL });

  return { cache, decide: createDecider({ classify, cache }) };
};

describe('createDecider', () => {
  test('returns the word to replace with, or null to leave the word alone', async () => {
    const { decide } = await deciderWith(async ({ post }) =>
      classificationOf(post.includes('Martial') ? { isPartOfName: 0.97 } : { replacementWord: 'greatness' }),
    );

    expect(await decide({ post: '⟦peak⟧ is back' })).toBe('greatness');
    expect(await decide({ post: 'Martial ⟦Peak⟧ chapter 245' })).toBeNull();
  });

  test('asks once per excerpt, even when the same excerpt is requested concurrently or again later', async () => {
    let calls = 0;
    const { decide } = await deciderWith(async () => {
      calls += 1;

      await Bun.sleep(5);

      return classificationOf({});
    });

    await Promise.all([decide({ post: 'this is ⟦peak⟧' }), decide({ post: 'this is ⟦peak⟧' })]);
    await decide({ post: 'this is ⟦peak⟧' });

    expect(calls).toBe(1);
  });

  test('retries rate limits, server errors, and network failures', async () => {
    const failures = [new DecisionsHttpError('rate limited', 429), new TransportError('offline')];
    const { decide } = await deciderWith(async () => {
      const failure = failures.shift();

      if (failure) throw failure;

      return classificationOf({});
    });

    expect(await decide({ post: 'this is ⟦peak⟧' })).toBe('great');
    expect(failures).toHaveLength(0);
  });

  test('does not retry a rejected request, and does not cache the failure', async () => {
    let calls = 0;
    const { decide, cache } = await deciderWith(async () => {
      calls += 1;

      throw new DecisionsHttpError('bad request', 400);
    });

    await expect(decide({ post: 'this is ⟦peak⟧' })).rejects.toBeInstanceOf(DecisionsHttpError);
    expect(calls).toBe(1);
    expect(cache.size).toBe(0);
  });

  test('runs at most six requests at once', async () => {
    let running = 0;
    let mostRunning = 0;
    const { decide } = await deciderWith(async () => {
      running += 1;
      mostRunning = Math.max(mostRunning, running);

      await Bun.sleep(5);

      running -= 1;

      return classificationOf({});
    });

    await Promise.all(Array.from({ length: 20 }, (_, index) => decide({ post: `post ${index} is ⟦peak⟧` })));

    expect(mostRunning).toBe(6);
  });
});
