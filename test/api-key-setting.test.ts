import { describe, expect, test } from 'bun:test';
import { ApiKeySetting, MissingApiKeyError } from '../src/api-key-setting.ts';
import { apiKeyForTest } from './api-key-for-test.ts';
import { MemoryStore } from './memory-store.ts';

describe('ApiKeySetting', () => {
  test('asks once, stores the answer, and reuses it', async () => {
    const store = new MemoryStore();
    let prompts = 0;
    const setting = new ApiKeySetting(store, () => {
      prompts += 1;

      return '  sk-or-test  ';
    });

    expect(await Promise.all([setting.get(), setting.get()])).toEqual([apiKeyForTest('sk-or-test'), apiKeyForTest('sk-or-test')]);
    expect(await new ApiKeySetting(store, () => 'unused').get()).toBe(apiKeyForTest('sk-or-test'));
    expect(prompts).toBe(1);
  });

  test('does not ask again on the same page after the prompt is dismissed', async () => {
    let prompts = 0;
    const setting = new ApiKeySetting(new MemoryStore(), () => {
      prompts += 1;

      return null;
    });

    await expect(setting.get()).rejects.toBeInstanceOf(MissingApiKeyError);
    await expect(setting.get()).rejects.toBeInstanceOf(MissingApiKeyError);
    expect(prompts).toBe(1);
  });

  test('forgets a rejected key so the next page load asks again', async () => {
    const store = new MemoryStore();
    const setting = new ApiKeySetting(store, () => 'sk-or-revoked');

    await setting.get();
    await setting.forget();

    await expect(setting.get()).rejects.toBeInstanceOf(MissingApiKeyError);
    expect(await new ApiKeySetting(store, () => 'sk-or-new').get()).toBe(apiKeyForTest('sk-or-new'));
  });

  test('replaces a stored key from the menu command', async () => {
    const store = new MemoryStore();
    const answers = ['sk-or-first', 'sk-or-second'];
    const setting = new ApiKeySetting(store, () => answers.shift() ?? null);

    await setting.get();
    await setting.replace();

    expect(await setting.get()).toBe(apiKeyForTest('sk-or-second'));
  });
});

describe('ApiKeySetting validation', () => {
  test('rejects an entered key containing spaces instead of storing it', async () => {
    const store = new MemoryStore();
    const setting = new ApiKeySetting(store, () => 'sk-or one two');

    await expect(setting.get()).rejects.toBeInstanceOf(MissingApiKeyError);
    expect(store.writeCount).toBe(0);
  });
});
