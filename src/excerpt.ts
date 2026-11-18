import type { Occurrence } from './occurrences.ts';

export const MARKER_OPEN = '⟦';
export const MARKER_CLOSE = '⟧';
const EXCERPT_RADIUS_CHARACTERS = 600;
const ELLIPSIS = '…';

const clipStartToWordBoundary = (text: string, index: number): number => {
  if (index <= 0) return 0;

  const nextSpace = text.slice(index).search(/\s/);

  return nextSpace === -1 ? index : index + nextSpace + 1;
};

const clipEndToWordBoundary = (text: string, index: number): number => {
  if (index >= text.length) return text.length;

  const previousSpace = text.slice(0, index).search(/\s\S*$/);

  return previousSpace === -1 ? index : previousSpace;
};

const collapseWhitespace = (text: string): string => text.replace(/\s*\n\s*/g, '\n').replace(/[^\S\n]+/g, ' ').trim();

export const buildExcerpt = (text: string, occurrence: Occurrence): string => {
  const occurrenceEnd = occurrence.start + occurrence.word.length;
  const excerptStart = Math.min(
    occurrence.start,
    clipStartToWordBoundary(text, occurrence.start - EXCERPT_RADIUS_CHARACTERS),
  );
  const excerptEnd = Math.max(occurrenceEnd, clipEndToWordBoundary(text, occurrenceEnd + EXCERPT_RADIUS_CHARACTERS));
  const before = text.slice(excerptStart, occurrence.start);
  const after = text.slice(occurrenceEnd, excerptEnd);
  const leadingEllipsis = excerptStart > 0 ? ELLIPSIS : '';
  const trailingEllipsis = excerptEnd < text.length ? ELLIPSIS : '';

  return collapseWhitespace(
    `${leadingEllipsis}${before}${MARKER_OPEN}${occurrence.word}${MARKER_CLOSE}${after}${trailingEllipsis}`,
  );
};
