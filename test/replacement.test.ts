import { describe, expect, test } from 'bun:test';
import { matchCase } from '../src/replacement.ts';

describe('matchCase', () => {
  test('copies lowercase, capitalised, and uppercase forms', () => {
    expect(matchCase({ original: 'peak', replacement: 'great' })).toBe('great');
    expect(matchCase({ original: 'Peak', replacement: 'great' })).toBe('Great');
    expect(matchCase({ original: 'PEAK', replacement: 'greatness' })).toBe('GREATNESS');
  });
});
