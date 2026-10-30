import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { Sigil, UnassignedSigil } from '../src/shell/Sigil.tsx';
import { sigilFor } from '../src/shell/sigil-model.ts';

// What a Sigil draws: the four cells of the name's pattern, a ring and a badge for a state, and nothing a screen reader would read out.
const markup = (props: Parameters<typeof Sigil>[0]) => renderToStaticMarkup(createElement(Sigil, props));

describe('a sigil', () => {
  test('draws the four cells and the hue of its name, and is hidden from assistive technology', () => {
    const { pattern, hue } = sigilFor('librarian');
    const html = markup({ name: 'librarian', size: 'lg' });

    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain(`data-hue="${hue}"`);
    expect(html).toContain('data-size="lg"');
    expect([...html.matchAll(/data-cell="(\w+)"/g)].map((match) => match[1])).toEqual([...pattern]);
    // Decorative: no text of its own, and no badge or ring without a state.
    expect(html.replace(/<[^>]*>/g, '')).toBe('');
    expect(html).not.toContain('data-state');
    expect(html).not.toContain('<b>');
  });

  test('is the same markup for the same name wherever it is drawn', () => {
    expect(markup({ name: 'coder', size: 'xs' }).replace('data-size="xs"', '')).toBe(markup({ name: 'coder', size: 'xl' }).replace('data-size="xl"', ''));
  });

  test('names its profile, so that something that belongs to the profile can find where it is drawn', () => {
    expect(markup({ name: 'librarian' })).toContain('data-profile="librarian"');
    expect(markup({ name: 'librarian', state: 'working' })).toContain('data-profile="librarian"');
    expect(markup({ name: 'all' })).not.toContain('data-profile');
    expect(renderToStaticMarkup(createElement(UnassignedSigil, { size: 'xs' }))).not.toContain('data-profile');
  });

  test('shows a state as a ring and a badge icon, each state’s own', () => {
    const badges = (['waiting', 'working', 'done', 'blocked'] as const).map((state) => {
      const html = markup({ name: 'coder', state });
      expect(html, state).toContain(`data-state="${state}"`);
      expect(html, state).toContain('<b>');
      return html.slice(html.indexOf('<b>'));
    });

    expect(new Set(badges).size).toBe(4);
  });

  test('shows an idle profile without a ring or a badge', () => {
    const html = markup({ name: 'coder', state: 'idle' });

    expect(html).not.toContain('data-state');
    expect(html).not.toContain('<b>');
  });

  test('draws the scope icon, not a pattern, for all profiles', () => {
    const html = markup({ name: 'all', size: 'sm' });

    expect(html).toContain('sigil--all');
    expect(html).not.toContain('data-cell');
    expect(html).toContain('<svg');
  });

  test('draws an empty dashed tile for nobody', () => {
    const html = renderToStaticMarkup(createElement(UnassignedSigil, { size: 'xs' }));

    expect(html).toContain('sigil--none');
    expect(html).toContain('aria-hidden="true"');
  });
});
