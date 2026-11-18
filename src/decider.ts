import { AnswerCache } from './answer-cache.ts';
import { DecisionsHttpError, TransportError, type Classify } from './decisions-client.ts';
import type { Decide } from './page-scanner.ts';
import { shouldReplace, type Answers, type DecisionState } from './questions.ts';

const MAXIMUM_CONCURRENT_REQUESTS = 6;
const MAXIMUM_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MILLISECONDS = 500;

const isRetryable = (error: unknown): boolean =>
  error instanceof TransportError || (error instanceof DecisionsHttpError && error.isRetryable);

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const createConcurrencyLimit = (maximum: number) => {
  let running = 0;
  const waiting: (() => void)[] = [];
  const acquire = (): Promise<void> => {
    if (running < maximum) {
      running += 1;

      return Promise.resolve();
    }

    return new Promise((resolve) => waiting.push(resolve));
  };
  const release = (): void => {
    const next = waiting.shift();

    if (next === undefined) running -= 1;
    else next();
  };

  return async <Result>(task: () => Promise<Result>): Promise<Result> => {
    await acquire();

    try {
      return await task();
    } finally {
      release();
    }
  };
};

const withRetries = async <Result>(task: () => Promise<Result>): Promise<Result> => {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      if (attempt >= MAXIMUM_ATTEMPTS || !isRetryable(error)) throw error;

      await sleep(RETRY_BASE_DELAY_MILLISECONDS * 2 ** (attempt - 1));
    }
  }
};

export const createDecider = ({ classify, cache }: { classify: Classify; cache: AnswerCache }): Decide => {
  const inFlight = new Map<string, Promise<Answers>>();
  const limit = createConcurrencyLimit(MAXIMUM_CONCURRENT_REQUESTS);
  const answersFor = (state: DecisionState): Promise<Answers> => {
    const cached = cache.get(state);

    if (cached !== undefined) return Promise.resolve(cached);

    const inFlightKey = JSON.stringify(state);
    const pending = inFlight.get(inFlightKey);

    if (pending !== undefined) return pending;

    const request = limit(() => withRetries(() => classify(state)))
      .then(({ answers }) => {
        cache.set(state, answers);

        return answers;
      })
      .finally(() => inFlight.delete(inFlightKey));

    inFlight.set(inFlightKey, request);

    return request;
  };

  return async (state) => {
    const answers = await answersFor(state);

    return shouldReplace(answers) ? answers.replacementWord : null;
  };
};
