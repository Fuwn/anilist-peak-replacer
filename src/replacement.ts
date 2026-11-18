export const matchCase = ({ original, replacement }: { original: string; replacement: string }): string => {
  const isAllUppercase = original === original.toUpperCase() && original !== original.toLowerCase();
  const firstLetter = original.charAt(0);
  const isCapitalised = firstLetter !== '' && firstLetter === firstLetter.toUpperCase();

  if (isAllUppercase) return replacement.toUpperCase();

  if (isCapitalised) return replacement.charAt(0).toUpperCase() + replacement.slice(1);

  return replacement;
};
