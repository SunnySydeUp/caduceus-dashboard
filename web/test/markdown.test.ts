import { describe, expect, test } from 'vitest';
import { classifyFence, mediaKindOf, parseMarkdown, safeUrl, type Block, type Inline } from '../src/modules/chat/markdown.ts';

/** The text of inline content, markup dropped: what the reader would read. */
function plain(inlines: readonly Inline[]): string {
  return inlines
    .map((node) => {
      switch (node.t) {
        case 'text':
        case 'code':
          return node.text;
        case 'math':
          return `$${node.tex}$`;
        case 'br':
          return '\n';
        case 'image':
          return node.alt;
        default:
          return plain(node.children);
      }
    })
    .join('');
}
const first = (text: string, streaming = false): Block => parseMarkdown(text, { streaming }).blocks[0]!;
const paragraph = (text: string) => {
  const block = first(text);
  if (block.t !== 'paragraph') throw new Error(`expected a paragraph, got ${block.t}`);
  return block.children;
};

describe('Markdown: blocks', () => {
  test('headings carry a level and a slug the outline can jump to; a repeated heading gets a distinct slug', () => {
    const { blocks } = parseMarkdown('# Plan\n\n## Plan\n\n### What `now`?');
    expect(blocks.map((block) => block.t === 'heading' && [block.level, block.id])).toEqual([
      [1, 'plan'],
      [2, 'plan-2'],
      [3, 'what-now'],
    ]);
  });

  test('a fenced block keeps its language and text verbatim', () => {
    expect(first('```ts\nconst a = 1;\n\n  indented\n```')).toEqual({ t: 'code', lang: 'ts', text: 'const a = 1;\n\n  indented', open: false });
  });

  test('half-streamed: a fence that has not closed yet is an open code block, never the rest of the page as prose', () => {
    const { blocks } = parseMarkdown('Here:\n\n```python\nprint(1)\nprint(', { streaming: true });
    expect(blocks[1]).toEqual({ t: 'code', lang: 'python', text: 'print(1)\nprint(', open: true });
  });

  test('lists nest, number and carry task state', () => {
    const block = first('1. one\n2. two\n   - inner\n   - [x] done');
    if (block.t !== 'list') throw new Error('not a list');
    expect(block.ordered).toBe(true);
    expect(block.items).toHaveLength(2);
    const nested = block.items[1]!.blocks[1]!;
    if (nested.t !== 'list') throw new Error('no nested list');
    expect(nested.ordered).toBe(false);
    expect(nested.items.map((item) => item.checked)).toEqual([undefined, true]);
  });

  test('a block quote holds blocks', () => {
    const block = first('> quoted\n> still quoted\n\nafter');
    if (block.t !== 'quote') throw new Error('not a quote');
    expect(block.children[0]).toMatchObject({ t: 'paragraph' });
  });

  test('a rule is a rule', () => {
    expect(parseMarkdown('a\n\n---\n\nb').blocks.map((block) => block.t)).toEqual(['paragraph', 'rule', 'paragraph']);
  });
});

describe('Markdown: inline', () => {
  test('emphasis, strong, strike and code', () => {
    expect(paragraph('a *b* **c** ~~d~~ `e*f*`')).toEqual([
      { t: 'text', text: 'a ' },
      { t: 'em', children: [{ t: 'text', text: 'b' }] },
      { t: 'text', text: ' ' },
      { t: 'strong', children: [{ t: 'text', text: 'c' }] },
      { t: 'text', text: ' ' },
      { t: 'del', children: [{ t: 'text', text: 'd' }] },
      { t: 'text', text: ' ' },
      { t: 'code', text: 'e*f*' },
    ]);
  });

  test('half-streamed emphasis and links stay literal text', () => {
    expect(plain(paragraph('so **bold and [a link](https://exa'))).toBe('so **bold and [a link](https://exa');
  });

  test('a newline inside a paragraph is a line break (chat text is typed, not wrapped)', () => {
    expect(paragraph('one\ntwo').map((node) => node.t)).toEqual(['text', 'br', 'text']);
  });

  test('money is not maths; $x^2$ is', () => {
    expect(plain(paragraph('it costs $5 and $6 total'))).toBe('it costs $5 and $6 total');
    expect(paragraph('so $x^2 + 1$ holds')[1]).toEqual({ t: 'math', tex: 'x^2 + 1' });
  });
});

describe('Markdown: raw HTML is never HTML', () => {
  test('a script tag and an event handler come out as text in a paragraph', () => {
    const inlines = paragraph('<script>alert(1)</script> and <img src=x onerror=alert(2)>');
    expect(inlines.every((node) => node.t === 'text')).toBe(true);
    expect(plain(inlines)).toBe('<script>alert(1)</script> and <img src=x onerror=alert(2)>');
  });

  test('a block of HTML is a paragraph of text, not an html node', () => {
    expect(parseMarkdown('<div onclick="x()">hi</div>\n\n<iframe src="https://evil"></iframe>').blocks.map((block) => block.t)).toEqual(['paragraph', 'paragraph']);
  });
});

describe('safe URLs', () => {
  test.each([
    ['https://example.com/a?b=1#c', 'https://example.com/a?b=1#c'],
    ['http://example.com', 'http://example.com'],
    ['mailto:me@example.com', 'mailto:me@example.com'],
    ['/chat/abc?message=4', '/chat/abc?message=4'],
    ['#section', '#section'],
    ['./pic.png', './pic.png'],
  ])('%s is allowed', (url, expected) => {
    expect(safeUrl(url, 'link')).toBe(expected);
  });

  test.each(['javascript:alert(1)', ' JaVaScRiPt:alert(1)', 'java\tscript:alert(1)', 'java\nscript:alert(1)', 'data:text/html;base64,PHNjcmlwdD4=', 'vbscript:x', 'file:///etc/passwd', '\u0001javascript:alert(1)', '//evil.example/x'])('%j is refused', (url) => {
    expect(safeUrl(url, 'link')).toBeUndefined();
    expect(safeUrl(url, 'media')).toBeUndefined();
  });

  test('media may be a data image, a link may not; an SVG data image is refused (it can carry script)', () => {
    expect(safeUrl('data:image/png;base64,iVBORw0KGgo=', 'media')).toBe('data:image/png;base64,iVBORw0KGgo=');
    expect(safeUrl('data:image/png;base64,iVBORw0KGgo=', 'link')).toBeUndefined();
    expect(safeUrl('data:image/svg+xml;base64,PHN2Zz4=', 'media')).toBeUndefined();
  });

  test('a link with an unsafe target is its text, not a link', () => {
    expect(paragraph('[click](javascript:alert(1)) now')[0]).toEqual({ t: 'text', text: 'click' });
  });
});

describe('Markdown: links and media', () => {
  test('a link keeps its target and children', () => {
    expect(paragraph('see [the **docs**](https://example.com/d)')[1]).toEqual({
      t: 'link',
      href: 'https://example.com/d',
      children: [{ t: 'text', text: 'the ' }, { t: 'strong', children: [{ t: 'text', text: 'docs' }] }],
    });
  });

  test('a bare URL becomes a link, without the sentence\'s full stop', () => {
    expect(paragraph('go to https://example.com/x.')[1]).toEqual({ t: 'link', href: 'https://example.com/x', children: [{ t: 'text', text: 'https://example.com/x' }] });
  });

  test.each([
    ['a.PNG', 'image'],
    ['https://x/y.webp?s=1', 'image'],
    ['clip.mp3', 'audio'],
    ['clip.m4a', 'audio'],
    ['movie.mp4', 'video'],
    ['movie.webm#t=3', 'video'],
    ['paper.pdf', 'pdf'],
    ['https://x/noextension', 'image'],
  ])('%s is %s', (url, kind) => {
    expect(mediaKindOf(url)).toBe(kind);
  });

  test('an image alone on its line is a media block of its kind; the unsafe one is not shown', () => {
    expect(parseMarkdown('![a cat](https://x/c.png)\n\n![song](s.mp3)\n\n![film](f.mp4)\n\n![paper](p.pdf)\n\n![bad](javascript:alert(1))').blocks).toEqual([
      { t: 'media', kind: 'image', src: 'https://x/c.png', alt: 'a cat' },
      { t: 'media', kind: 'audio', src: 's.mp3', alt: 'song' },
      { t: 'media', kind: 'video', src: 'f.mp4', alt: 'film' },
      { t: 'media', kind: 'pdf', src: 'p.pdf', alt: 'paper' },
      { t: 'paragraph', children: [{ t: 'text', text: 'bad' }] },
    ]);
  });

  test('an image inside a sentence stays inline', () => {
    expect(paragraph('look ![x](https://x/c.png) there')[1]).toEqual({ t: 'image', src: 'https://x/c.png', alt: 'x' });
  });
});

describe('Markdown: maths', () => {
  test('a display block between $$ lines', () => {
    expect(first('$$\n\\int_0^1 x\\,dx\n$$')).toEqual({ t: 'math', tex: '\\int_0^1 x\\,dx', open: false });
  });

  test('a one-line $$ block and a \\[ \\] block', () => {
    expect(first('$$a+b$$')).toEqual({ t: 'math', tex: 'a+b', open: false });
    expect(first('\\[\nc\n\\]')).toEqual({ t: 'math', tex: 'c', open: false });
  });

  test('half-streamed: an unfinished display block is open', () => {
    expect(first('$$\n\\frac{a}{', true)).toEqual({ t: 'math', tex: '\\frac{a}{', open: true });
  });
});

describe('Markdown: tables', () => {
  const table = '| Name | Qty |\n|:-----|----:|\n| apple | 3 |\n| **pear** | 12 |';

  test('header, alignment and rows of inline cells', () => {
    const block = first(table);
    if (block.t !== 'table') throw new Error('not a table');
    expect(block.align).toEqual(['left', 'right']);
    expect(block.head.map(plain)).toEqual(['Name', 'Qty']);
    expect(block.rows.map((row) => row.map(plain))).toEqual([
      ['apple', '3'],
      ['pear', '12'],
    ]);
  });

  test('half-streamed: a row cut mid-way is padded to the header, and a header with no delimiter yet is prose', () => {
    const cut = first('| a | b |\n|---|---|\n| 1 | 2 |\n| 3 ', true);
    if (cut.t !== 'table') throw new Error('not a table');
    expect(cut.rows.map((row) => row.map(plain))).toEqual([['1', '2'], ['3', '']]);
    expect(first('| a | b |', true).t).toBe('paragraph');
  });
});

describe('fences', () => {
  test.each([
    ['mermaid', 'mermaid'],
    ['json', 'json'],
    ['jsonc', 'json'],
    ['yaml', 'yaml'],
    ['yml', 'yaml'],
    ['html', 'html'],
    ['ts', 'code'],
    ['', 'code'],
  ])('%j is %s', (lang, kind) => {
    expect(classifyFence(lang)).toBe(kind);
  });
});
