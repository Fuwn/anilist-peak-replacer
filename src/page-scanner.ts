import { buildExcerpt } from './excerpt.ts';
import { findOccurrences, type Occurrence } from './occurrences.ts';
import type { DecisionState, ReplacementWord } from './questions.ts';
import { matchCase } from './replacement.ts';

export type Decide = (state: DecisionState) => Promise<ReplacementWord | null>;

export const REPLACED_CLASS = 'peak-replacer-word';
export const REPLACEMENT_CLASS = 'peak-replacer-replacement';
export const ORIGINAL_CLASS = 'peak-replacer-original';

export const STYLESHEET = `
.${REPLACED_CLASS} { cursor: help; font-style: italic; }
.${REPLACED_CLASS} .${ORIGINAL_CLASS} { display: none; }
.${REPLACED_CLASS}:hover { font-style: normal; }
.${REPLACED_CLASS}:hover .${REPLACEMENT_CLASS} { display: none; }
.${REPLACED_CLASS}:hover .${ORIGINAL_CLASS} { display: inline; }
`;

const SKIPPED_ANCESTOR_SELECTOR = `script, style, noscript, textarea, input, select, code, pre, a, [contenteditable=""], [contenteditable="true"], .${REPLACED_CLASS}`;
const POST_SELECTOR = '.markdown';
const FALLBACK_BLOCK_SELECTOR = 'p, li, blockquote, h1, h2, h3, h4, h5, h6, td, th, dd, dt, figcaption, div, section, article, body';
const LINE_BREAK_ELEMENTS = new Set(['BR', 'P', 'DIV', 'LI', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TR']);
const SCAN_DELAY_MILLISECONDS = 150;
const ANILIST_TITLE_SUFFIX = /\s*·\s*AniList\s*$/;

export const describePage = (documentTitle: string): string | undefined => {
  const title = documentTitle.replace(ANILIST_TITLE_SUFFIX, '').trim();

  return title === '' || title === 'AniList' ? undefined : title;
};

const readAniListPageTitle = (): string | undefined => describePage(document.title);

interface Replacement {
  occurrence: Occurrence;
  word: ReplacementWord;
}

interface ScannerOptions {
  decide: Decide;
  reportError?: (error: unknown) => void;
  readPageTitle?: () => string | undefined;
}

const isTextNode = (node: Node): node is Text => node.nodeType === Node.TEXT_NODE;
const isElement = (node: Node): node is Element => node.nodeType === Node.ELEMENT_NODE;

interface BlockText {
  text: string;
  offsets: Map<Text, number>;
}

const readTextWithOriginalWords = (block: Element): BlockText => {
  let text = '';
  const offsets = new Map<Text, number>();
  const visit = (node: Node): void => {
    if (isTextNode(node)) {
      offsets.set(node, text.length);

      text += node.data;

      return;
    }

    if (!isElement(node)) return;

    if (node.classList.contains(REPLACED_CLASS)) {
      text += node.getAttribute('data-original') ?? '';

      return;
    }

    const breaksLine = LINE_BREAK_ELEMENTS.has(node.tagName);

    if (breaksLine && text !== '' && !text.endsWith('\n')) text += '\n';

    node.childNodes.forEach(visit);

    if (breaksLine && !text.endsWith('\n')) text += '\n';
  };

  visit(block);

  return { text, offsets };
};

const createReplacement = (original: string, word: ReplacementWord): HTMLSpanElement => {
  const wrapper = document.createElement('span');
  const replacement = document.createElement('span');
  const originalWord = document.createElement('span');

  wrapper.className = REPLACED_CLASS;
  wrapper.dataset.original = original;
  replacement.className = REPLACEMENT_CLASS;
  replacement.textContent = matchCase({ original, replacement: word });
  originalWord.className = ORIGINAL_CLASS;
  originalWord.textContent = original;

  wrapper.append(replacement, originalWord);

  return wrapper;
};

export class PageScanner {
  private readonly textSentForDecision = new WeakMap<Text, string>();
  private readonly pendingRoots = new Set<Node>();
  private observer: MutationObserver | undefined;
  private scanTimer: ReturnType<typeof setTimeout> | undefined;

  private readonly decide: Decide;
  private readonly reportError: (error: unknown) => void;
  private readonly readPageTitle: () => string | undefined;

  constructor({
    decide,
    reportError = (error) => console.error('[peak-replacer]', error),
    readPageTitle = readAniListPageTitle,
  }: ScannerOptions) {
    this.decide = decide;
    this.reportError = reportError;
    this.readPageTitle = readPageTitle;
  }

  async scan(root: Node): Promise<void> {
    const blockTexts = new Map<Element, BlockText>();
    const work = this.collectCandidateTextNodes(root).map(({ textNode, parent }) => {
      const block = parent.closest(POST_SELECTOR) ?? parent.closest(FALLBACK_BLOCK_SELECTOR) ?? parent;
      let blockText = blockTexts.get(block);

      if (blockText === undefined) {
        blockText = readTextWithOriginalWords(block);

        blockTexts.set(block, blockText);
      }

      return this.handleTextNode(textNode, blockText);
    });

    await Promise.all(work);
  }

  start(root: Element): Promise<void> {
    this.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'characterData') this.pendingRoots.add(mutation.target);

        mutation.addedNodes.forEach((node) => this.pendingRoots.add(node));
      }

      this.scheduleScan();
    });

    this.observer.observe(root, { childList: true, subtree: true, characterData: true });

    return this.scan(root);
  }

  stop(): void {
    this.observer?.disconnect();
    clearTimeout(this.scanTimer);
  }

  private scheduleScan(): void {
    if (this.scanTimer !== undefined || this.pendingRoots.size === 0) return;

    this.scanTimer = setTimeout(() => {
      const roots = [...this.pendingRoots].filter((node) => node.isConnected);

      this.scanTimer = undefined;

      this.pendingRoots.clear();

      for (const root of roots) this.scan(root).catch(this.reportError);
    }, SCAN_DELAY_MILLISECONDS);
  }

  private collectCandidateTextNodes(root: Node): { textNode: Text; parent: Element }[] {
    const candidates: { textNode: Text; parent: Element }[] = [];
    const consider = (node: Node): void => {
      const parent = node.parentElement;

      if (!isTextNode(node) || parent === null || parent.closest(SKIPPED_ANCESTOR_SELECTOR) !== null) return;

      if (this.textSentForDecision.get(node) === node.data || findOccurrences(node.data).length === 0) return;

      candidates.push({ textNode: node, parent });
    };

    if (isTextNode(root)) {
      consider(root);

      return candidates;
    }

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);

    while (walker.nextNode()) consider(walker.currentNode);

    return candidates;
  }

  private async handleTextNode(textNode: Text, blockText: BlockText): Promise<void> {
    const originalData = textNode.data;
    const nodeOffset = blockText.offsets.get(textNode) ?? 0;
    const occurrences = findOccurrences(originalData);

    this.textSentForDecision.set(textNode, originalData);

    const pageTitle = this.readPageTitle();
    const decided = await Promise.all(
      occurrences.map(async (occurrence): Promise<Replacement | null> => {
        const post = buildExcerpt(blockText.text, { ...occurrence, start: nodeOffset + occurrence.start });

        try {
          const word = await this.decide(pageTitle === undefined ? { post } : { post, page_title: pageTitle });

          return word === null ? null : { occurrence, word };
        } catch (error) {
          this.reportError(error);

          return null;
        }
      }),
    );
    const replacements = decided.filter((replacement) => replacement !== null);

    if (replacements.length === 0 || !textNode.isConnected || textNode.data !== originalData) return;

    this.replaceOccurrences(textNode, replacements);
  }

  private replaceOccurrences(textNode: Text, replacements: Replacement[]): void {
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    const appendText = (text: string): void => {
      if (text === '') return;

      const piece = document.createTextNode(text);

      this.textSentForDecision.set(piece, text);
      fragment.append(piece);
    };

    for (const { occurrence, word } of replacements) {
      appendText(textNode.data.slice(cursor, occurrence.start));
      fragment.append(createReplacement(occurrence.word, word));

      cursor = occurrence.start + occurrence.word.length;
    }

    appendText(textNode.data.slice(cursor));
    textNode.replaceWith(fragment);
  }
}
