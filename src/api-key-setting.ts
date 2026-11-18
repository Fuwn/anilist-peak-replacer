import type { KeyValueStore } from './answer-cache.ts';
import { isOpenRouterApiKey, type OpenRouterApiKey } from './api-key.ts';

const STORAGE_KEY = 'openrouter-api-key';

const PROMPT_MESSAGE = [
  'AniList Peak Replacer needs an OpenRouter API key to tell slang "peak" apart from other uses.',
  '',
  'Create one at https://openrouter.ai/settings/keys and paste it below.',
  'Your userscript manager stores it, and the script sends it only to openrouter.ai.',
].join('\n');

export class MissingApiKeyError extends Error {
  constructor() {
    super('No OpenRouter API key is set.');

    this.name = 'MissingApiKeyError';
  }
}

export class ApiKeySetting {
  private pendingKey: Promise<OpenRouterApiKey> | undefined;
  private hasPromptedThisPage = false;

  constructor(
    private readonly store: KeyValueStore,
    private readonly ask: (message: string) => string | null = (message) => window.prompt(message),
  ) {}

  get(): Promise<OpenRouterApiKey> {
    this.pendingKey ??= this.loadOrAsk().catch((error) => {
      this.pendingKey = undefined;

      throw error;
    });

    return this.pendingKey;
  }

  async replace(): Promise<void> {
    this.hasPromptedThisPage = false;
    this.pendingKey = undefined;

    await this.store.write(STORAGE_KEY, null);
    await this.get().catch(() => undefined);
  }

  async forget(): Promise<void> {
    this.pendingKey = Promise.reject(new MissingApiKeyError());

    this.pendingKey.catch(() => undefined);

    await this.store.write(STORAGE_KEY, null);
  }

  private async loadOrAsk(): Promise<OpenRouterApiKey> {
    const stored = await this.store.read(STORAGE_KEY);

    if (isOpenRouterApiKey(stored)) return stored;

    if (this.hasPromptedThisPage) throw new MissingApiKeyError();

    this.hasPromptedThisPage = true;

    const entered = this.ask(PROMPT_MESSAGE)?.trim();

    if (!isOpenRouterApiKey(entered)) throw new MissingApiKeyError();

    await this.store.write(STORAGE_KEY, entered);

    return entered;
  }
}
