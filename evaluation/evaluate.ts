import { parseArgs } from 'node:util';
import { isOpenRouterApiKey } from '../src/api-key.ts';
import { createClassifier, type Classification, type HttpPost } from '../src/decisions-client.ts';
import { buildExcerpt } from '../src/excerpt.ts';
import { describePage } from '../src/page-scanner.ts';
import { shouldReplace, THRESHOLD_TUNED_MODEL, type DecisionState, type ReplacementWord } from '../src/questions.ts';
import rawCases from './cases.json' with { type: 'json' };

type Verdict = `replace-${ReplacementWord}` | 'keep';
type Expected = Verdict | 'unclear';

const EXPECTED_VALUES: readonly Expected[] = ['replace-great', 'replace-greatness', 'keep', 'unclear'];
const SPLITS = ['tuning', 'holdout'] as const;
const MAXIMUM_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MILLISECONDS = 60_000;

interface Case {
  id: string;
  source: string;
  text: string;
  start: number;
  expected: Expected;
  split: (typeof SPLITS)[number];
  pageTitle: string | null;
}

type Outcome =
  | {
      kind: 'answered';
      testCase: Case;
      excerpt: string;
      latencyMilliseconds: number;
      classification: Classification;
      verdict: Verdict;
    }
  | { kind: 'failed'; testCase: Case; excerpt: string; latencyMilliseconds: number; error: string };

type AnsweredOutcome = Extract<Outcome, { kind: 'answered' }>;

const isExpected = (value: unknown): value is Expected => EXPECTED_VALUES.some((expected) => expected === value);
const isSplit = (value: unknown): value is Case['split'] => SPLITS.some((split) => split === value);

const isCase = (value: unknown): value is Case =>
  typeof value === 'object' &&
  value !== null &&
  'id' in value &&
  typeof value.id === 'string' &&
  'source' in value &&
  typeof value.source === 'string' &&
  'text' in value &&
  typeof value.text === 'string' &&
  'start' in value &&
  typeof value.start === 'number' &&
  /^peak$/i.test(value.text.slice(value.start, value.start + 4)) &&
  'expected' in value &&
  isExpected(value.expected) &&
  'split' in value &&
  isSplit(value.split) &&
  'pageTitle' in value &&
  (value.pageTitle === null || typeof value.pageTitle === 'string');

const parseCases = (value: unknown): Case[] => {
  if (!Array.isArray(value)) throw new Error('evaluation/cases.json must hold an array of cases.');

  const invalid = value.filter((item) => !isCase(item));

  if (invalid.length > 0) throw new Error(`evaluation/cases.json has ${invalid.length} malformed cases.`);

  return value.filter(isCase);
};

const { values: options } = parseArgs({
  options: {
    models: { type: 'string', default: THRESHOLD_TUNED_MODEL },
    split: { type: 'string', default: 'all' },
    concurrency: { type: 'string', default: '8' },
    verbose: { type: 'boolean', default: false },
    'without-page-title': { type: 'boolean', default: false },
  },
});

const apiKey = process.env.OPENROUTER_API_KEY;

if (!isOpenRouterApiKey(apiKey)) {
  console.error('Set OPENROUTER_API_KEY (for example in .env) to run the evaluation.');
  process.exit(1);
}

const fetchPost: HttpPost = async ({ url, headers, body }) => {
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MILLISECONDS),
  });

  return { status: response.status, body: await response.text() };
};

const selectedCases = parseCases(rawCases).filter((testCase) => options.split === 'all' || testCase.split === options.split);

const runWithConcurrency = async <Item, Result>({
  items,
  concurrency,
  worker,
}: {
  items: Item[];
  concurrency: number;
  worker: (item: Item) => Promise<Result>;
}): Promise<Result[]> => {
  const results = new Map<number, Result>();
  const queue = items.entries();
  const runWorker = async () => {
    for (const [index, item] of queue) results.set(index, await worker(item));
  };

  await Promise.all(Array.from({ length: concurrency }, runWorker));

  return [...results.entries()].sort(([first], [second]) => first - second).map(([, result]) => result);
};

const stateFor = (testCase: Case, excerpt: string): DecisionState => {
  const pageTitle =
    options['without-page-title'] || testCase.pageTitle === null ? undefined : describePage(testCase.pageTitle);

  return pageTitle === undefined ? { post: excerpt } : { post: excerpt, page_title: pageTitle };
};

const classifyCase = async ({ model, testCase }: { model: string; testCase: Case }): Promise<Outcome> => {
  const classify = createClassifier({ apiKey, model, post: fetchPost });
  const word = testCase.text.slice(testCase.start, testCase.start + 4);
  const excerpt = buildExcerpt(testCase.text, { start: testCase.start, word });
  const startedAt = performance.now();
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAXIMUM_ATTEMPTS; attempt += 1) {
    try {
      const classification = await classify(stateFor(testCase, excerpt));
      const { answers } = classification;
      const verdict: Verdict = shouldReplace(answers) ? `replace-${answers.replacementWord}` : 'keep';

      return {
        kind: 'answered',
        testCase,
        excerpt,
        latencyMilliseconds: performance.now() - startedAt,
        classification,
        verdict,
      };
    } catch (error) {
      lastError = error;

      if (attempt < MAXIMUM_ATTEMPTS) await Bun.sleep(1000 * attempt);
    }
  }

  return { kind: 'failed', testCase, excerpt, latencyMilliseconds: performance.now() - startedAt, error: String(lastError) };
};

const percentile = (sorted: number[], fraction: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;

const formatPercent = ({ numerator, denominator }: { numerator: number; denominator: number }) =>
  denominator === 0 ? 'n/a' : `${((100 * numerator) / denominator).toFixed(1)}% (${numerator}/${denominator})`;

const describeOutcome = (outcome: AnsweredOutcome) => {
  const { answers } = outcome.classification;
  const probabilities = `slang ${answers.isSlangPraise.toFixed(2)} name ${answers.isPartOfName.toFixed(2)} mention ${answers.isAboutTheWord.toFixed(2)} ${answers.replacementWord}`;
  const context = outcome.excerpt.replace(/\s+/g, ' ');
  const markerIndex = context.indexOf('⟦');

  return `  - ${outcome.testCase.id} [${probabilities}] …${context.slice(Math.max(0, markerIndex - 70), markerIndex + 50)}…`;
};

const summarise = ({ model, outcomes }: { model: string; outcomes: Outcome[] }) => {
  const answered = outcomes.filter((outcome): outcome is AnsweredOutcome => outcome.kind === 'answered');
  const failures = outcomes.filter((outcome) => outcome.kind === 'failed');
  const scored = answered.filter((outcome) => outcome.testCase.expected !== 'unclear');
  const shouldBeReplaced = scored.filter((outcome) => outcome.testCase.expected !== 'keep');
  const wereReplaced = scored.filter((outcome) => outcome.verdict !== 'keep');
  const correctlyReplaced = wereReplaced.filter((outcome) => outcome.testCase.expected !== 'keep');
  const rightWord = correctlyReplaced.filter((outcome) => outcome.verdict === outcome.testCase.expected);
  const exactlyRight = scored.filter((outcome) => outcome.verdict === outcome.testCase.expected);
  const latencies = outcomes.map((outcome) => outcome.latencyMilliseconds).sort((first, second) => first - second);
  const costDollars = answered.reduce((total, outcome) => total + outcome.classification.usage.costDollars, 0);
  const wrongReplacements = wereReplaced.filter((outcome) => outcome.testCase.expected === 'keep');
  const missedReplacements = shouldBeReplaced.filter((outcome) => outcome.verdict === 'keep');
  const wrongWord = correctlyReplaced.filter((outcome) => outcome.verdict !== outcome.testCase.expected);
  const [firstFailure] = failures;

  console.log(`\n## ${model}`);
  console.log(`Exactly right:          ${formatPercent({ numerator: exactlyRight.length, denominator: scored.length })}`);
  console.log(`Precision (replaced):   ${formatPercent({ numerator: correctlyReplaced.length, denominator: wereReplaced.length })}`);
  console.log(`Recall (slang caught):  ${formatPercent({ numerator: correctlyReplaced.length, denominator: shouldBeReplaced.length })}`);
  console.log(`Right word when caught: ${formatPercent({ numerator: rightWord.length, denominator: correctlyReplaced.length })}`);
  console.log(`Latency p50 / p95:      ${percentile(latencies, 0.5).toFixed(0)} ms / ${percentile(latencies, 0.95).toFixed(0)} ms`);
  console.log(`Cost:                   $${costDollars.toFixed(6)} for ${outcomes.length} requests`);
  console.log(`Errors:                 ${failures.length}${firstFailure ? ` (first: ${firstFailure.error.slice(0, 160)})` : ''}`);

  for (const [heading, list] of [
    ['Wrong replacements', wrongReplacements],
    ['Missed replacements', missedReplacements],
    ['Wrong word', wrongWord],
  ] as const) {
    if (list.length === 0) continue;

    console.log(`${heading}:`);

    for (const outcome of list.slice(0, options.verbose ? list.length : 8)) console.log(describeOutcome(outcome));

    if (!options.verbose && list.length > 8) console.log(`  … ${list.length - 8} more (pass --verbose)`);
  }

  return {
    model,
    exactlyRight: exactlyRight.length / scored.length,
    precision: correctlyReplaced.length / wereReplaced.length,
    recall: correctlyReplaced.length / shouldBeReplaced.length,
    medianLatencyMilliseconds: percentile(latencies, 0.5),
    costDollars,
    errors: failures.length,
  };
};

const models = options.models
  .split(',')
  .map((model) => model.trim())
  .filter(Boolean);
const summaries = [];

console.log(`Evaluating ${selectedCases.length} cases (${options.split}) on ${models.join(', ')}`);

for (const model of models) {
  const outcomes = await runWithConcurrency({
    items: selectedCases,
    concurrency: Number(options.concurrency),
    worker: (testCase) => classifyCase({ model, testCase }),
  });

  await Bun.write(`evaluation/results/${model.replaceAll('/', '__')}.json`, JSON.stringify(outcomes, null, 2));

  summaries.push(summarise({ model, outcomes }));
}

if (summaries.length > 1) {
  console.log('\n## Comparison');
  console.table(
    summaries.map((summary) => ({
      model: summary.model,
      'exactly right': summary.exactlyRight.toFixed(3),
      precision: summary.precision.toFixed(3),
      recall: summary.recall.toFixed(3),
      'p50 ms': summary.medianLatencyMilliseconds.toFixed(0),
      'cost $': summary.costDollars.toFixed(5),
      errors: summary.errors,
    })),
  );
}
