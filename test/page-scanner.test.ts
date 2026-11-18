import { afterEach, describe, expect, test } from 'bun:test';
import { PageScanner, REPLACED_CLASS, STYLESHEET, type Decide } from '../src/page-scanner.ts';
import type { DecisionState } from '../src/questions.ts';

const THREAD_FIXTURE = await Bun.file(new URL('./fixtures/thread-93136.html', import.meta.url)).text();

const fakeDecide = (excerpts: string[] = []): Decide => async ({ post }) => {
  excerpts.push(post);

  if (/Martial ⟦peak⟧|⟦peak⟧ of the/i.test(post)) return null;

  return /⟦peak⟧ is back/i.test(post) ? 'greatness' : 'great';
};

const render = (html: string, title = 'AniList'): HTMLElement => {
  document.title = title;
  document.body.innerHTML = html;

  return document.body;
};

const visibleText = (element: Element): string => {
  const clone = element.cloneNode(true) as Element;

  clone.querySelectorAll('.peak-replacer-original').forEach((node) => node.remove());

  return clone.textContent ?? '';
};

let scanner: PageScanner | undefined;

afterEach(() => {
  scanner?.stop();

  scanner = undefined;
  document.body.innerHTML = '';
});

describe('PageScanner on forum thread 93136', () => {
  test('replaces every slang "peak" and keeps its capitalisation', async () => {
    const body = render(THREAD_FIXTURE);

    await new PageScanner({ decide: fakeDecide() }).scan(body);

    const text = visibleText(body);

    expect(text).toContain('overall GREAT episode 1');
    expect(text).toContain('GREATNESS IS BACK!!!!');
    expect(text).toContain('Greatness is back and its just started');
    expect(text).not.toMatch(/\bpeak\b/i);
  });

  test('keeps the original word on the page for hover', async () => {
    const body = render(THREAD_FIXTURE);

    await new PageScanner({ decide: fakeDecide() }).scan(body);

    const replaced = [...body.querySelectorAll(`.${REPLACED_CLASS}`)];

    expect(replaced.map((element) => element.getAttribute('data-original'))).toEqual(['PEAK', 'PEAK', 'Peak']);
    expect(replaced.map((element) => element.querySelector('.peak-replacer-original')?.textContent)).toEqual(['PEAK', 'PEAK', 'Peak']);
    expect(STYLESHEET).toContain(`.${REPLACED_CLASS}:hover .peak-replacer-original { display: inline; }`);
  });

  test('sends the whole post as context, with line breaks and only one occurrence marked', async () => {
    const excerpts: string[] = [];
    const body = render(THREAD_FIXTURE);

    await new PageScanner({ decide: fakeDecide(excerpts) }).scan(body);

    const threadBodyExcerpt = excerpts.find((excerpt) => excerpt.includes('BANGER'));

    expect(excerpts).toHaveLength(3);
    expect(threadBodyExcerpt).toContain('BANGER animation is backk!!\nPretty decent OP');
    expect(threadBodyExcerpt).toContain('overall ⟦PEAK⟧ episode 1');
  });
});

describe('PageScanner', () => {
  test('tells the model what the page is about, without the site name', async () => {
    const states: DecisionState[] = [];
    const body = render('<div class="markdown">Peak is back</div>', '[Spoilers] Blue Box Season 2 - Episode 1 Discussion · AniList');

    await new PageScanner({
      decide: async (state) => {
        states.push(state);

        return null;
      },
    }).scan(body);

    expect(states).toEqual([{ post: '⟦Peak⟧ is back', page_title: '[Spoilers] Blue Box Season 2 - Episode 1 Discussion' }]);
  });

  test('leaves the page title out when it is only the site name', async () => {
    const states: DecisionState[] = [];
    const body = render('<div class="markdown">Peak is back</div>', 'AniList');

    await new PageScanner({
      decide: async (state) => {
        states.push(state);

        return null;
      },
    }).scan(body);

    expect(states).toEqual([{ post: '⟦Peak⟧ is back' }]);
  });

  test('leaves links, code, and editable text alone', async () => {
    const excerpts: string[] = [];
    const body = render(`
      <div class="markdown">
        <a href="https://anilist.co/manga/71237/Peak/">Peak</a>
        <code>peak</code>
        <textarea>peak</textarea>
        <div contenteditable="true">peak</div>
      </div>`);

    await new PageScanner({ decide: fakeDecide(excerpts) }).scan(body);

    expect(excerpts).toEqual([]);
    expect(body.querySelector(`.${REPLACED_CLASS}`)).toBeNull();
  });

  test('replaces only the occurrences the model approves within one text node', async () => {
    const body = render('<div class="markdown">Martial Peak is peak fiction</div>');

    await new PageScanner({ decide: fakeDecide() }).scan(body);

    expect(visibleText(body)).toBe('Martial Peak is great fiction');
  });

  test('leaves the text as it is when a decision fails, and reports the failure', async () => {
    const errors: unknown[] = [];
    const body = render('<div class="markdown">this is peak</div>');

    await new PageScanner({
      decide: async () => {
        throw new Error('offline');
      },
      reportError: (error) => errors.push(error),
    }).scan(body);

    expect(visibleText(body)).toBe('this is peak');
    expect(errors).toHaveLength(1);
  });

  test('does not touch text that changed while its decision was pending', async () => {
    const body = render('<div class="markdown">this is peak</div>');
    const textNode = body.querySelector('.markdown')?.firstChild;

    if (!(textNode instanceof Text)) throw new Error('The fixture should start with a text node.');

    await new PageScanner({
      decide: async () => {
        textNode.data = 'edited: this is peak';

        return 'great';
      },
    }).scan(body);

    expect(visibleText(body)).toBe('edited: this is peak');
  });

  test('scans comments AniList renders later, without asking about earlier ones again', async () => {
    const excerpts: string[] = [];
    const body = render('<div class="markdown">this is peak</div>');

    scanner = new PageScanner({ decide: fakeDecide(excerpts) });

    await scanner.start(body);

    const comment = document.createElement('div');

    comment.className = 'markdown';
    comment.textContent = 'another peak episode';

    body.append(comment);

    await Bun.sleep(400);

    expect(visibleText(body)).toBe('this is greatanother great episode');
    expect(excerpts).toEqual(['this is ⟦peak⟧', 'another ⟦peak⟧ episode']);
  });

  test('a second scan of an already replaced post asks nothing new', async () => {
    const excerpts: string[] = [];
    const body = render('<div class="markdown">peak fiction, the peak of the series, peak again</div>');
    const pageScanner = new PageScanner({ decide: fakeDecide(excerpts) });

    await pageScanner.scan(body);
    await pageScanner.scan(body);

    expect(visibleText(body)).toBe('great fiction, the peak of the series, great again');
    expect(excerpts).toHaveLength(3);
  });
});
