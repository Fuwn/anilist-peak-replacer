import { describe, expect, test } from 'bun:test';
import { shouldReplace, type Answers } from '../src/questions.ts';

const answers = (overrides: Partial<Answers>): Answers => ({
  isSlangPraise: 0.95,
  isPartOfName: 0.02,
  isAboutTheWord: 0.03,
  replacementWord: 'great',
  ...overrides,
});

describe('shouldReplace', () => {
  test('replaces clear slang praise', () => {
    expect(shouldReplace(answers({}))).toBe(true);
  });

  test('leaves the word alone unless slang praise is a clear yes', () => {
    expect(shouldReplace(answers({ isSlangPraise: 0.5 }))).toBe(false);
    expect(shouldReplace(answers({ isSlangPraise: 0.1 }))).toBe(false);
  });

  test('leaves names alone unless the name answer is a clear no', () => {
    expect(shouldReplace(answers({ isPartOfName: 0.9 }))).toBe(false);
    expect(shouldReplace(answers({ isPartOfName: 0.5 }))).toBe(false);
  });

  test('leaves mentions of the word alone unless the mention answer is a clear no', () => {
    expect(shouldReplace(answers({ isAboutTheWord: 0.9 }))).toBe(false);
    expect(shouldReplace(answers({ isAboutTheWord: 0.5 }))).toBe(false);
  });
});
