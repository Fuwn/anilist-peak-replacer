import { AnswerCache } from './answer-cache.ts';
import { ApiKeySetting, MissingApiKeyError } from './api-key-setting.ts';
import { createDecider } from './decider.ts';
import { createClassifier, DecisionsHttpError, type Classify } from './decisions-client.ts';
import { PageScanner, STYLESHEET } from './page-scanner.ts';
import { THRESHOLD_TUNED_MODEL } from './questions.ts';
import { addStyle, registerMenuCommand, userscriptPost, userscriptStore } from './userscript-manager.ts';

const LOG_PREFIX = '[peak-replacer]';

const main = async (): Promise<void> => {
  const cache = await AnswerCache.load({ store: userscriptStore, model: THRESHOLD_TUNED_MODEL });
  const apiKeySetting = new ApiKeySetting(userscriptStore);
  const reportedMessages = new Set<string>();
  const classify: Classify = async (state) => {
    const apiKey = await apiKeySetting.get();

    return createClassifier({ apiKey, model: THRESHOLD_TUNED_MODEL, post: userscriptPost })(state);
  };
  const reportOnce = (message: string, error: unknown): void => {
    if (reportedMessages.has(message)) return;

    reportedMessages.add(message);
    console.warn(`${LOG_PREFIX} ${message}`, error);
  };
  const reportError = (error: unknown): void => {
    if (error instanceof MissingApiKeyError) {
      reportOnce('No OpenRouter API key is set, so the script leaves "peak" unchanged.', error);

      return;
    }

    if (error instanceof DecisionsHttpError && error.isAuthenticationFailure) {
      reportOnce('OpenRouter rejected the API key. The script will ask for a new one on the next page load.', error);
      apiKeySetting.forget().catch(() => undefined);

      return;
    }

    reportOnce('A decision failed, so the script left that "peak" unchanged.', error);
  };

  addStyle(STYLESHEET);
  registerMenuCommand('Set OpenRouter API key', () => void apiKeySetting.replace());

  await new PageScanner({ decide: createDecider({ classify, cache }), reportError }).start(document.body);
};

main().catch((error) => console.error(LOG_PREFIX, error));
