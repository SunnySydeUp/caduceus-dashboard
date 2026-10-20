import { describe, expect, test } from 'vitest';
import { HTML_SANDBOX, htmlPreviewDocument, MERMAID_CONFIG, svgImageSource } from '../src/modules/chat/embeds.ts';
import { highlightCode, renderMath } from '../src/modules/chat/renderers.ts';

describe('HTML preview: sandboxed', () => {
  test('the sandbox grants nothing: no scripts, no same-origin, no forms, no popups, no top navigation', () => {
    expect(HTML_SANDBOX).toBe('');
  });

  test('the document carries a policy that forbids scripts, frames, forms and connections, and loads only data and https images', () => {
    const doc = htmlPreviewDocument('<h1>hi</h1><script>parent.postMessage("owned","*")</script>');
    const policy = /Content-Security-Policy" content="([^"]+)"/.exec(doc)?.[1] ?? '';
    expect(policy).toContain("default-src 'none'");
    expect(policy).not.toMatch(/script-src|connect-src|frame-src|form-action/);
    expect(policy).toContain('img-src data: https:');
    // The reply's HTML comes after the policy: nothing of it can come before and replace the meta.
    expect(doc.indexOf('Content-Security-Policy')).toBeLessThan(doc.indexOf('<h1>'));
    expect(doc).toContain('<h1>hi</h1>');
  });

  test('a reply cannot close the policy early: the head it writes comes after', () => {
    const doc = htmlPreviewDocument('</head><meta http-equiv="refresh" content="0;url=https://evil.example">');
    expect(doc.startsWith('<!doctype html><meta http-equiv="Content-Security-Policy"')).toBe(true);
  });
});

describe('Mermaid: strict, and shown as an image', () => {
  test('the engine runs in strict mode and without HTML labels', () => {
    expect(MERMAID_CONFIG).toMatchObject({ startOnLoad: false, securityLevel: 'strict', flowchart: { htmlLabels: false } });
  });

  test('the SVG becomes the source of an <img>, where nothing in it runs; script and handlers are removed as well', () => {
    const uri = svgImageSource('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script><a href="javascript:alert(3)"><text onclick="x()">A &amp; B</text></a></svg>');
    expect(uri.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true);
    const svg = decodeURIComponent(uri.slice('data:image/svg+xml;charset=utf-8,'.length));
    expect(svg).not.toMatch(/<script|onload|onclick|javascript:/i);
    expect(svg).toContain('A &amp; B');
  });
});

describe('code and maths renderers', () => {
  test('highlighted code is escaped: markup in the source is text', async () => {
    const html = await highlightCode('html', '<script>alert(1)</script><img src=x onerror=alert(2)>');
    expect(html).not.toMatch(/<script|<img/);
    expect(html).toContain('&lt;');
  });

  test('a known language gets token spans; an unknown one is left to plain text', async () => {
    expect(await highlightCode('python', 'def f():\n    return 1')).toContain('hljs-keyword');
    expect(await highlightCode('klingon', 'qapla')).toBeUndefined();
  });

  test('maths renders to KaTeX markup; a link in it is not trusted; a half-typed formula is refused, not rendered wrongly', async () => {
    const html = await renderMath('x^2 + \\frac{1}{2}', true);
    expect(html).toContain('class="katex-display"');
    expect(html).toContain('katex-html');
    const linked = await renderMath('\\href{javascript:alert(1)}{click}', false);
    expect(linked ?? '').not.toMatch(/href=|<a /);
    expect(await renderMath('\\frac{a}{', false)).toBeUndefined();
  });
});
