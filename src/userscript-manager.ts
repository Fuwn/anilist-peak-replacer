import type { KeyValueStore } from './answer-cache.ts';
import { TransportError, type HttpPost } from './decisions-client.ts';

interface XmlHttpRequestResponse {
  status: number;
  responseText: string;
}

interface XmlHttpRequestDetails {
  method: 'POST';
  url: string;
  headers: Record<string, string>;
  data: string;
  timeout: number;
  onload: (response: XmlHttpRequestResponse) => void;
  onerror: () => void;
  ontimeout: () => void;
}

type XmlHttpRequest = (details: XmlHttpRequestDetails) => unknown;

declare const GM:
  | {
      xmlHttpRequest?: XmlHttpRequest;
      getValue?: (key: string, defaultValue?: unknown) => Promise<unknown>;
      setValue?: (key: string, value: unknown) => Promise<void>;
      addStyle?: (css: string) => unknown;
      registerMenuCommand?: (caption: string, onClick: () => void) => unknown;
    }
  | undefined;

declare const GM_xmlhttpRequest: XmlHttpRequest | undefined;
declare const GM_getValue: ((key: string, defaultValue?: unknown) => unknown) | undefined;
declare const GM_setValue: ((key: string, value: unknown) => void) | undefined;
declare const GM_registerMenuCommand: ((caption: string, onClick: () => void) => unknown) | undefined;

const REQUEST_TIMEOUT_MILLISECONDS = 20_000;
const STORAGE_PREFIX = 'peak-replacer:';
const modernApi = () => (typeof GM === 'undefined' ? undefined : GM);

const findXmlHttpRequest = (): XmlHttpRequest | undefined =>
  modernApi()?.xmlHttpRequest ?? (typeof GM_xmlhttpRequest === 'function' ? GM_xmlhttpRequest : undefined);

export const userscriptPost: HttpPost = ({ url, headers, body }) => {
  const xmlHttpRequest = findXmlHttpRequest();

  if (xmlHttpRequest === undefined) {
    return fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MILLISECONDS) }).then(
      async (response) => ({ status: response.status, body: await response.text() }),
      (error) => {
        throw new TransportError(`Request failed: ${error}`);
      },
    );
  }

  return new Promise((resolve, reject) => {
    xmlHttpRequest({
      method: 'POST',
      url,
      headers,
      data: body,
      timeout: REQUEST_TIMEOUT_MILLISECONDS,
      onload: (response) => resolve({ status: response.status, body: response.responseText }),
      onerror: () => reject(new TransportError('Request failed before a response arrived.')),
      ontimeout: () => reject(new TransportError(`Request timed out after ${REQUEST_TIMEOUT_MILLISECONDS} ms.`)),
    });
  });
};

/** Values are stored as JSON strings, the one format every manager round-trips faithfully. */
export const userscriptStore: KeyValueStore = {
  async read(key) {
    const storageKey = STORAGE_PREFIX + key;
    const api = modernApi();
    let raw: unknown;

    if (api?.getValue) raw = await api.getValue(storageKey);
    else if (typeof GM_getValue === 'function') raw = GM_getValue(storageKey);

    if (typeof raw !== 'string') return undefined;

    try {
      const parsed: unknown = JSON.parse(raw);

      return parsed;
    } catch {
      return undefined;
    }
  },

  async write(key, value) {
    const storageKey = STORAGE_PREFIX + key;
    const raw = JSON.stringify(value);
    const api = modernApi();

    if (api?.setValue) await api.setValue(storageKey, raw);
    else if (typeof GM_setValue === 'function') GM_setValue(storageKey, raw);
  },
};

export const registerMenuCommand = (caption: string, onClick: () => void): void => {
  const api = modernApi();

  if (api?.registerMenuCommand) api.registerMenuCommand(caption, onClick);
  else if (typeof GM_registerMenuCommand === 'function') GM_registerMenuCommand(caption, onClick);
};

export const addStyle = (css: string): void => {
  const style = document.createElement('style');

  style.textContent = css;

  (document.head ?? document.documentElement).append(style);
};
