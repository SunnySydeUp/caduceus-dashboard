import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test, vi } from 'vitest';

// The overlay layer stack listens to the window's `popstate` and the document's keys when it is first loaded (the lightbox is a layer); there is neither here.
vi.stubGlobal('window', { addEventListener: () => undefined });
vi.stubGlobal('document', { addEventListener: () => undefined });
const { Rich } = await import('../src/modules/chat/Rich.tsx');
const { TreeView } = await import('../src/modules/chat/StructuredBlock.tsx');

/** What the page would show for a message, as markup. Effects do not run here, so lazy renderers show their fallbacks. */
const html = (text: string, streaming = false) => renderToStaticMarkup(createElement(Rich, { text, streaming, anchor: 'm1' }));

describe('rendering: Markdown', () => {
  test('headings, emphasis, lists, quotes, links and rules become elements; a heading carries the id the outline scrolls to', () => {
    const out = html('# Title\n\nSome **strong** and *em* with a [link](https://example.com).\n\n- one\n- [x] two\n\n> quoted\n\n---');
    expect(out).toContain('<h2 id="m1-title" class="rich__heading">Title</h2>');
    expect(out).toContain('<strong>strong</strong>');
    expect(out).toContain('<em>em</em>');
    expect(out).toContain('<a href="https://example.com" target="_blank" rel="noopener noreferrer">link</a>');
    expect(out).toMatch(/<ul><li><div class="rich__item"><p>one<\/p><\/div><\/li><li class="rich__task"><span class="rich__check" role="img" aria-label="Done" data-checked="">/);
    expect(out).not.toContain('<input');
    expect(out).toContain('<blockquote>');
    expect(out).toContain('<hr/>');
  });

  test('half-streamed: unfinished emphasis and links render as text, and the page structure is intact', () => {
    const out = html('So **half and [a link](https://exa', true);
    expect(out).toBe('<div class="rich"><p>So **half and [a link](https://exa</p></div>');
  });
});

describe('rendering: code', () => {
  test('a closed fence is a code figure with its language and a Copy button', () => {
    const out = html('```python\nprint("a < b")\n```');
    expect(out).toContain('<figcaption class="code__head"><span class="grow">python</span>');
    expect(out).toContain('Copy');
    expect(out).toContain('<code>print(&quot;a &lt; b&quot;)</code>');
  });

  test('half-streamed: an open fence is a code figure holding what has come, and the text before it is a paragraph', () => {
    const out = html('Run this:\n\n```bash\nnpm ins', true);
    expect(out).toContain('<p>Run this:</p>');
    expect(out).toContain('<code>npm ins</code>');
    expect(out.match(/<figure/g)).toHaveLength(1);
  });
});

describe('rendering: maths', () => {
  test('a formula shows its TeX until KaTeX has rendered it (and for good when KaTeX will not take it)', () => {
    expect(html('Inline $x^2$ here')).toContain('<code class="rich__math-source">x^2</code>');
    expect(html('$$\n\\frac{a}{b}\n$$')).toContain('<pre class="rich__math-source" tabindex="0"><code>\\frac{a}{b}</code></pre>');
  });

  test('half-streamed: an unfinished display block is its source, and nothing after it is swallowed because there is nothing after it', () => {
    expect(html('Before\n\n$$\n\\frac{a}{', true)).toContain('<code>\\frac{a}{</code>');
  });
});

describe('rendering: Mermaid', () => {
  test('the diagram source is shown until drawn; markup in it is text', () => {
    const out = html('```mermaid\ngraph TD\n  A["<script>alert(1)</script>"] --> B\n```');
    expect(out).not.toContain('<script');
    expect(out).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(out).toContain('<span class="grow">mermaid</span>');
  });

  test('half-streamed: an open diagram is drawn from nothing yet, only shown as source', () => {
    expect(html('```mermaid\ngraph TD\n  A --', true)).toContain('<code>graph TD\n  A --</code>');
  });
});

describe('rendering: tables', () => {
  const rows = (count: number) => Array.from({ length: count }, (_, index) => `| r${index} | ${index} |`).join('\n');

  test('a table sits in a scroll container of its own, with sortable column headers', () => {
    const out = html(`| Name | Qty |\n|:--|--:|\n${rows(2)}`);
    expect(out).toContain('class="rich__table-scroll"');
    expect(out).toContain('role="group"');
    expect(out).toContain('aria-sort="none"');
    expect(out).toContain('press to sort');
    expect(out).toContain('style="text-align:right"');
    expect(out).not.toContain('type="search"');
  });

  test('a longer table has a filter box', () => {
    expect(html(`| Name | Qty |\n|--|--|\n${rows(6)}`)).toContain('type="search"');
  });

  test('half-streamed: a cut row is padded and the table stays a table', () => {
    const out = html('| a | b |\n|--|--|\n| 1 | 2 |\n| 3', true);
    expect(out.match(/<tr>/g)).toHaveLength(3);
    expect(out).toContain('<td style="text-align:left">3</td>'.replace(' style="text-align:left"', ''));
  });
});

describe('rendering: JSON and YAML trees', () => {
  const tree = (lang: 'json' | 'yaml', value: unknown) => renderToStaticMarkup(createElement(TreeView, { lang, text: '', value }));

  test('rows with depth, key, value and a collapse control on containers', () => {
    const out = tree('json', { name: 'x', list: [1, 2], empty: {} });
    expect(out).toContain('role="tree"');
    expect(out).toContain('aria-label="Collapse list"');
    expect(out).toContain('aria-expanded="true"');
    expect(out).toContain('<span class="rich__key">name: </span><span class="rich__value rich__value--string">&quot;x&quot;</span>');
    expect(out).not.toContain('aria-label="Collapse empty"');
    expect(out).toContain('aria-level="3"');
  });

  test('a string in the tree is text, whatever it holds', () => {
    const out = tree('yaml', { note: '<img src=x onerror=alert(1)>' });
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  test('a JSON or YAML block still arriving, or not a document, is shown as code', () => {
    const out = html('```json\n{"a": [1, ', true);
    expect(out).toContain('<span class="grow">json</span>');
    expect(out).not.toContain('role="tree"');
    expect(html('```yaml\na: [1, 2\n```')).not.toContain('role="tree"');
  });
});

describe('rendering: images, audio, video and PDF', () => {
  test('an image is a button that opens the lightbox, with its alt text', () => {
    const out = html('![a cat](https://example.com/cat.png)');
    expect(out).toContain('<img src="https://example.com/cat.png" alt="a cat" loading="lazy" referrerPolicy="no-referrer" class="rich__image"/>'.replace(' referrerPolicy="no-referrer"', ' referrerPolicy="no-referrer"'));
    expect(out).toContain('aria-label="Open image larger: a cat"');
  });

  test('audio and video get players that load nothing until played', () => {
    expect(html('![song](https://example.com/s.mp3)')).toContain('<audio controls="" preload="none" src="https://example.com/s.mp3"');
    expect(html('![film](https://example.com/f.mp4)')).toContain('<video controls="" preload="metadata" playsInline="" src="https://example.com/f.mp4"');
  });

  test('a PDF is a card with Preview and Open; the preview frame is not in the page until asked for', () => {
    const out = html('![paper](https://example.com/p.pdf)');
    expect(out).toContain('Preview');
    expect(out).toContain('href="https://example.com/p.pdf" target="_blank" rel="noopener noreferrer"');
    expect(out).not.toContain('<object');
  });

  test('a media address that is not safe is not in the page at all', () => {
    const out = html('![x](javascript:alert(1))\n\n![y](data:text/html;base64,PHNjcmlwdD4=)\n\n[z](javascript:alert(2))');
    expect(out).not.toMatch(/javascript:|data:text/);
    expect(out).not.toContain('<img');
  });
});

describe('rendering: HTML preview, sandboxed', () => {
  const attack = '<h1>Hi</h1><script>document.title="owned"</script><img src=x onerror="alert(1)">';

  test('the HTML is only ever the srcdoc of a frame with an empty sandbox; the page itself holds none of it as markup', () => {
    const out = html(`\`\`\`html\n${attack}\n\`\`\``);
    expect(out).toContain('<iframe class="rich__frame" title="HTML preview" sandbox=""');
    expect(out).toContain('srcDoc=');
    expect(out).not.toContain('allow-scripts');
    expect(out).not.toContain('allow-same-origin');
    // Every `<` of the reply is inside an attribute, escaped.
    const outside = out.replace(/srcDoc="[^"]*"/g, '');
    expect(outside).not.toMatch(/<script|<img|<h1/);
  });

  test('half-streamed HTML is shown as source, not run in a frame', () => {
    const out = html('```html\n<div>par', true);
    expect(out).not.toContain('<iframe');
    expect(out).toContain('<code>&lt;div&gt;par</code>');
  });
});

describe('rendering: raw HTML and script in the text', () => {
  test('is text, in a paragraph', () => {
    const out = html('<script>alert(1)</script> <img src=x onerror=alert(2)> <a href="javascript:alert(3)">x</a> <iframe src="https://evil.example"></iframe>');
    expect(out).not.toMatch(/<script|<img|<iframe|href="javascript/);
    expect(out).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});
