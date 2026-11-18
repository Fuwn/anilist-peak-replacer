import { describe, expect, test } from 'bun:test';
import { buildExcerpt } from '../src/excerpt.ts';
import { findOccurrences } from '../src/occurrences.ts';

const excerptOf = (text: string, occurrenceIndex = 0) => buildExcerpt(text, findOccurrences(text)[occurrenceIndex]!);

describe('buildExcerpt', () => {
  test('marks only the chosen occurrence', () => {
    const text = 'peak fiction, or the peak of the series?';

    expect(excerptOf(text, 0)).toBe('⟦peak⟧ fiction, or the peak of the series?');
    expect(excerptOf(text, 1)).toBe('peak fiction, or the ⟦peak⟧ of the series?');
  });

  test('keeps a short post whole', () => {
    expect(excerptOf('Yeah it was peak fiction')).toBe('Yeah it was ⟦peak⟧ fiction');
  });

  test('clips a long post at word boundaries and marks the cut', () => {
    const filler = 'word '.repeat(300);
    const excerpt = excerptOf(`${filler}this is peak ${filler}`);

    expect(excerpt.startsWith('…word')).toBe(true);
    expect(excerpt.endsWith('word…')).toBe(true);
    expect(excerpt).toContain('this is ⟦peak⟧ word');
    expect(excerpt.length).toBeLessThan(1300);
  });

  test('never cuts into the occurrence when the text has no spaces', () => {
    const excerpt = excerptOf(`${'x'.repeat(2000)} peak ${'y'.repeat(2000)}`);

    expect(excerpt).toContain('⟦peak⟧');
  });
});

describe('buildExcerpt whitespace', () => {
  test('collapses whitespace the way a browser renders it', () => {
    expect(excerptOf('first line\n\n  second   line is\tpeak  \n')).toBe('first line\nsecond line is ⟦peak⟧');
  });
});
