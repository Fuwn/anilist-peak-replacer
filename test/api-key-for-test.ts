import { isOpenRouterApiKey, type OpenRouterApiKey } from '../src/api-key.ts';

export const apiKeyForTest = (value: string): OpenRouterApiKey => {
  if (!isOpenRouterApiKey(value)) throw new Error(`"${value}" is not a valid API key shape.`);

  return value;
};
