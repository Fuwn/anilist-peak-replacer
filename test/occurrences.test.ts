import { describe, expect, test } from 'bun:test';
import { findOccurrences } from '../src/occurrences.ts';

const words = (text: string) => findOccurrences(text).map(({ word }) => word);

describe('findOccurrences', () => {
  test('finds every capitalisation of the standalone word', () => {
    expect(findOccurrences('peak, Peak and PEAK!')).toEqual([
      { start: 0, word: 'peak' },
      { start: 6, word: 'Peak' },
      { start: 15, word: 'PEAK' },
    ]);
  });

  test('ignores longer words that contain it', () => {
    expect(words('it peaked early, peaks and peaking, Peakfest')).toEqual([]);
  });

  test('ignores the word inside URLs', () => {
    expect(words('https://anilist.co/manga/71237/Peak/ www.peak.com anilist.co/manga/1/Peak and peak')).toEqual(['peak']);
  });

  test('keeps the word next to punctuation', () => {
    expect(words('(peak) "peak" peak... peak?!')).toEqual(['peak', 'peak', 'peak', 'peak']);
  });
});
