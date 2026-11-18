export type OpenRouterApiKey = string & { readonly __brand: 'OpenRouterApiKey' };

const API_KEY_PATTERN = /^\S+$/;

export const isOpenRouterApiKey = (value: unknown): value is OpenRouterApiKey =>
  typeof value === 'string' && API_KEY_PATTERN.test(value);
