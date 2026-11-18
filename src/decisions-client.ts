import type { OpenRouterApiKey } from './api-key.ts';
import { isReplacementWord, questions, THRESHOLD_TUNED_MODEL, type Answers, type DecisionState, type ReplacementWord } from './questions.ts';

export const DECISIONS_URL = 'https://openrouter.ai/api/alpha/decisions';

export interface HttpRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

export interface HttpResponse {
  status: number;
  body: string;
}

export type HttpPost = (request: HttpRequest) => Promise<HttpResponse>;

const TOO_MANY_REQUESTS = 429;
const FIRST_SERVER_ERROR = 500;

export class DecisionsHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);

    this.name = 'DecisionsHttpError';
  }

  get isAuthenticationFailure(): boolean {
    return this.status === 401 || this.status === 403;
  }

  get isRetryable(): boolean {
    return this.status === TOO_MANY_REQUESTS || this.status >= FIRST_SERVER_ERROR;
  }
}

export class MalformedResponseError extends Error {
  constructor(message: string) {
    super(message);

    this.name = 'MalformedResponseError';
  }
}

export class TransportError extends Error {
  constructor(message: string) {
    super(message);

    this.name = 'TransportError';
  }
}

export interface Usage {
  costDollars: number;
  inputTokens: number;
}

export interface Classification {
  answers: Answers;
  model: string;
  usage: Usage;
}

export type Classify = (state: DecisionState) => Promise<Classification>;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const readRecord = (container: Record<string, unknown>, key: string): Record<string, unknown> => {
  const value = container[key];

  if (!isRecord(value)) throw new MalformedResponseError(`Response has no "${key}" object.`);

  return value;
};

const readNoul = (answers: Record<string, unknown>, key: string): number => {
  const probability = readRecord(answers, key).noul;

  if (typeof probability !== 'number') throw new MalformedResponseError(`Answer "${key}" is missing its probability.`);

  return probability;
};

const readReplacementWord = (answers: Record<string, unknown>): ReplacementWord => {
  const word = readRecord(answers, 'replacement_word').choice;

  if (!isReplacementWord(word)) {
    throw new MalformedResponseError(`Answer "replacement_word" has unknown choice ${JSON.stringify(word)}.`);
  }

  return word;
};

const readOptionalNumber = (container: Record<string, unknown>, key: string): number => {
  const value = container[key];

  return typeof value === 'number' ? value : 0;
};

export const parseDecisionsResponse = (body: string): Classification => {
  let parsed: unknown;

  try {
    parsed = JSON.parse(body);
  } catch {
    throw new MalformedResponseError(`Response is not JSON: ${body.slice(0, 200)}`);
  }

  if (!isRecord(parsed)) throw new MalformedResponseError('Response is not a JSON object.');

  const answers = readRecord(parsed, 'answers');
  const usage = isRecord(parsed.usage) ? parsed.usage : {};

  return {
    answers: {
      isSlangPraise: readNoul(answers, 'is_slang_praise'),
      isPartOfName: readNoul(answers, 'is_part_of_name'),
      isAboutTheWord: readNoul(answers, 'is_about_the_word'),
      replacementWord: readReplacementWord(answers),
    },
    model: typeof parsed.model === 'string' ? parsed.model : '',
    usage: {
      costDollars: readOptionalNumber(usage, 'cost'),
      inputTokens: readOptionalNumber(usage, 'input_tokens'),
    },
  };
};

export const buildRequestBody = ({ model, state }: { model: string; state: DecisionState }): string =>
  JSON.stringify({ model, state, questions });

export const createClassifier =
  ({ apiKey, model = THRESHOLD_TUNED_MODEL, post }: { apiKey: OpenRouterApiKey; model?: string; post: HttpPost }): Classify =>
  async (state) => {
    const headers = {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
      'x-title': 'AniList Peak Replacer',
    };
    const response = await post({ url: DECISIONS_URL, headers, body: buildRequestBody({ model, state }) });

    if (response.status < 200 || response.status >= 300) {
      throw new DecisionsHttpError(
        `Decisions request failed with ${response.status}: ${response.body.slice(0, 300)}`,
        response.status,
      );
    }

    return parseDecisionsResponse(response.body);
  };
