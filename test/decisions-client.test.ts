import { describe, expect, test } from 'bun:test';
import {
  createClassifier,
  DecisionsHttpError,
  DECISIONS_URL,
  MalformedResponseError,
  type HttpPost,
  type HttpRequest,
} from '../src/decisions-client.ts';
import { apiKeyForTest } from './api-key-for-test.ts';

const SUCCESS_BODY = JSON.stringify({
  model: 'typesafe/jev-1.14-20261014',
  answers: {
    is_slang_praise: { type: 'noul', noul: 0.91 },
    is_part_of_name: { type: 'noul', noul: 0.02 },
    is_about_the_word: { type: 'noul', noul: 0.05 },
    replacement_word: { type: 'choice', choice: 'greatness', probabilities: { great: 0.2, greatness: 0.8 } },
  },
  usage: { input_tokens: 400, output_tokens: 60, cost: 0.0000168 },
});

const respondWith =
  ({ status, body, requests = [] }: { status: number; body: string; requests?: HttpRequest[] }): HttpPost =>
  async (request) => {
    requests.push(request);

    return { status, body };
  };

const classifierRespondingWith = (response: { status: number; body: string; requests?: HttpRequest[] }) =>
  createClassifier({ apiKey: apiKeyForTest('test-key'), model: 'typesafe/jev-1.14', post: respondWith(response) });

describe('createClassifier', () => {
  test('sends the excerpt as state with every question and reads the answers', async () => {
    const requests: HttpRequest[] = [];
    const classify = classifierRespondingWith({ status: 200, body: SUCCESS_BODY, requests });
    const classification = await classify({ post: '⟦PEAK⟧ IS BACK!!!!' });
    const [request] = requests;

    expect(request).toBeDefined();

    const sent = JSON.parse(request?.body ?? '{}');

    expect(request?.url).toBe(DECISIONS_URL);
    expect(request?.headers.authorization).toBe('Bearer test-key');
    expect(sent.model).toBe('typesafe/jev-1.14');
    expect(sent.state).toEqual({ post: '⟦PEAK⟧ IS BACK!!!!' });
    expect(Object.keys(sent.questions).sort()).toEqual(['is_about_the_word', 'is_part_of_name', 'is_slang_praise', 'replacement_word']);
    expect(classification.answers).toEqual({ isSlangPraise: 0.91, isPartOfName: 0.02, isAboutTheWord: 0.05, replacementWord: 'greatness' });
    expect(classification.usage).toEqual({ costDollars: 0.0000168, inputTokens: 400 });
  });

  test('turns an error status into a DecisionsHttpError carrying the status', async () => {
    const classify = classifierRespondingWith({ status: 401, body: '{"error":{"code":401}}' });
    const error = await classify({ post: 'peak' }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(DecisionsHttpError);

    if (!(error instanceof DecisionsHttpError)) return;

    expect(error.status).toBe(401);
    expect(error.isAuthenticationFailure).toBe(true);
    expect(error.isRetryable).toBe(false);
  });

  test('treats rate limits and server errors as retryable', () => {
    expect(new DecisionsHttpError('rate limited', 429).isRetryable).toBe(true);
    expect(new DecisionsHttpError('unavailable', 503).isRetryable).toBe(true);
    expect(new DecisionsHttpError('bad request', 400).isRetryable).toBe(false);
  });

  test('rejects a response that is missing an answer instead of guessing', async () => {
    const body = JSON.stringify({ answers: { is_slang_praise: { noul: 0.9 } } });

    await expect(classifierRespondingWith({ status: 200, body })({ post: 'peak' })).rejects.toBeInstanceOf(MalformedResponseError);
  });

  test('rejects a replacement word the questions never offered', async () => {
    const body = SUCCESS_BODY.replace('"choice":"greatness"', '"choice":"excellent"');

    await expect(classifierRespondingWith({ status: 200, body })({ post: 'peak' })).rejects.toBeInstanceOf(MalformedResponseError);
  });

  test('rejects a body that is not JSON', async () => {
    await expect(classifierRespondingWith({ status: 200, body: '<html>' })({ post: 'peak' })).rejects.toBeInstanceOf(
      MalformedResponseError,
    );
  });
});
