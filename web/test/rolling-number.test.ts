import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { RollingNumber } from '../src/shell/RollingNumber.tsx';

// What a RollingNumber draws before anything has changed: the number as it is, hidden from a screen reader, and the plain number once, for it. The roll itself is a change of
// value in a browser (a CSS animation, `.roll` in sigil.css) and is checked there.
const markup = (props: Parameters<typeof RollingNumber>[0]) => renderToStaticMarkup(createElement(RollingNumber, props));

describe('a rolling number', () => {
  test('is drawn as it is at first, with no old number sliding out', () => {
    const html = markup({ value: 3 });

    expect(html).toContain('class="roll__in"');
    expect(html).not.toContain('roll__out');
    expect(html).not.toContain('data-dir');
  });

  test('gives a screen reader the plain number once, and hides the drawn digits from it', () => {
    const html = markup({ value: 12 });

    expect(html.match(/<span class="sr-only">12<\/span>/g)).toHaveLength(1);
    expect(html).toContain('<span class="roll__in" aria-hidden="true">12</span>');
  });

  test('says "99+" for what is above its ceiling, in the drawn digits and for a screen reader', () => {
    const html = markup({ value: 130, ceiling: 99 });

    expect(html).toContain('<span class="sr-only">99+</span>');
    expect(html).toContain('aria-hidden="true">99+</span>');
    expect(markup({ value: 99, ceiling: 99 })).toContain('<span class="sr-only">99</span>');
  });
});
