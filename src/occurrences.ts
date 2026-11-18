const PEAK_PATTERN = /\bpeak\b/gi;
const URL_TOKEN_PATTERN = /^(?:[a-z][\w+.-]*:\/\/|www\.)|\.[a-z]{2,}\//i;

export interface Occurrence {
  start: number;
  word: string;
}

const tokenAround = (text: string, start: number, end: number): string => {
  let tokenStart = start;
  let tokenEnd = end;

  while (tokenStart > 0 && !/\s/.test(text.charAt(tokenStart - 1))) tokenStart -= 1;

  while (tokenEnd < text.length && !/\s/.test(text.charAt(tokenEnd))) tokenEnd += 1;

  return text.slice(tokenStart, tokenEnd);
};

export const findOccurrences = (text: string): Occurrence[] =>
  [...text.matchAll(PEAK_PATTERN)]
    .map((match) => ({ start: match.index, word: match[0] }))
    .filter(({ start, word }) => !URL_TOKEN_PATTERN.test(tokenAround(text, start, start + word.length)));
