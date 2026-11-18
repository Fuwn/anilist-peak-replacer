import { describe, expect, test } from 'bun:test';
import { AnswerCache } from '../src/answer-cache.ts';
import { createDecider } from '../src/decider.ts';
import { isOpenRouterApiKey } from '../src/api-key.ts';
import { createClassifier, type HttpPost } from '../src/decisions-client.ts';
import { PageScanner } from '../src/page-scanner.ts';
import { THRESHOLD_TUNED_MODEL } from '../src/questions.ts';
import { MemoryStore } from './memory-store.ts';

const apiKey = process.env.OPENROUTER_API_KEY;
const isEnabled = process.env.PEAK_REPLACER_LIVE === '1' && isOpenRouterApiKey(apiKey);
const THREAD_FIXTURE = await Bun.file(new URL('./fixtures/thread-93136.html', import.meta.url)).text();
const LIVE_TIMEOUT_MILLISECONDS = 30_000;

const fetchPost: HttpPost = async ({ url, headers, body }) => {
  const response = await fetch(url, { method: 'POST', headers, body });

  return { status: response.status, body: await response.text() };
};

const scanWithJev = async (html: string, title: string): Promise<string> => {
  document.title = title;
  document.body.innerHTML = html;

  if (!isOpenRouterApiKey(apiKey)) throw new Error('Set OPENROUTER_API_KEY to run the live tests.');

  const cache = await AnswerCache.load({ store: new MemoryStore(), model: THRESHOLD_TUNED_MODEL });
  const classify = createClassifier({ apiKey, model: THRESHOLD_TUNED_MODEL, post: fetchPost });
  const errors: unknown[] = [];

  await new PageScanner({ decide: createDecider({ classify, cache }), reportError: (error) => errors.push(error) }).scan(
    document.body,
  );

  expect(errors).toEqual([]);
  document.querySelectorAll('.peak-replacer-original').forEach((node) => node.remove());

  return document.body.textContent ?? '';
};

describe.skipIf(!isEnabled)('live: Jev on OpenRouter', () => {
  test(
    'replaces all three slang uses in forum thread 93136',
    async () => {
      const text = await scanWithJev(THREAD_FIXTURE, '[Spoilers] Blue Box Season 2 - Episode 1 Discussion · AniList');

      expect(text).toContain('overall GREAT episode 1');
      expect(text).toMatch(/GREAT(NESS)? IS BACK!!!!/);
      expect(text).toMatch(/Great(ness)? is back and its just started/);
      expect(text).not.toMatch(/\bpeak\b/i);
    },
    LIVE_TIMEOUT_MILLISECONDS,
  );

  test(
    'leaves titles, the highest-point sense, and talk about the word alone',
    async () => {
      const posts = [
        'I am curently at chapter 245 of Martial Peak and i am considering dropping it.',
        'S3P2 will always be the peak of AoT, none of the other seasons are even remotely close.',
        'I keep seeing people call everything "peak" lately, the word means nothing now.',
        'We finally hiked to the peak and the view from the summit was worth it.',
      ];
      const text = await scanWithJev(posts.map((post) => `<div class="markdown">${post}</div>`).join(''), 'AniList');

      expect(text).toBe(posts.join(''));
    },
    LIVE_TIMEOUT_MILLISECONDS,
  );
});
