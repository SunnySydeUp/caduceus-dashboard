import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';
import { APPEARANCE_CHOICES, type Appearance } from '@caduceus/contracts/appearance';
import { APPEARANCE_KEY, AUTO_COMPACT_QUERY, attributesOf, parseLocal, reconcile, type AppearanceAttributes } from '../src/appearance.ts';

const tokens = fs.readFileSync(new URL('../../docs/design/tokens.css', import.meta.url), 'utf8');
const valuesOf = (attribute: string) => new Set([...tokens.matchAll(new RegExp(`\\[${attribute}="([\\w-]+)"\\]`, 'g'))].map((match) => match[1]));

// This device's appearance as the page applies it: the attributes on <html> that tokens.css switches on.
describe('attributes on <html>', () => {
  test('theme, skin and density are set as chosen, and text size 100% sets no attribute', () => {
    expect(attributesOf({ theme: 'dark', skin: 'hermes', density: 'compact', textSize: 'md' })).toEqual({
      'data-theme': 'dark',
      'data-skin': 'hermes',
      'data-density': 'compact',
      'data-text-scale': null,
    });
  });

  test('the other text sizes are the values tokens.css scales the root by', () => {
    const scale = (textSize: 'sm' | 'lg' | 'xl') => attributesOf({ theme: 'system', skin: 'desk', density: 'auto', textSize })['data-text-scale'];

    expect([scale('sm'), scale('lg'), scale('xl')]).toEqual(['sm', 'lg', 'xl']);
  });

  test('every choice the app offers is one tokens.css styles, and tokens.css styles no other', () => {
    // Nous is the base of `:root` and has no `[data-skin="nous"]` block of its own (Desk, the default, overrides it for a page that names no skin and for `desk`); light, dark and system share `color-scheme` blocks.
    expect(valuesOf('data-skin')).toEqual(new Set(APPEARANCE_CHOICES.skin.filter((skin) => skin !== 'nous')));
    expect(valuesOf('data-theme')).toEqual(new Set(APPEARANCE_CHOICES.theme));
    // `auto` is the media-query block; compact and comfortable have their own.
    expect(valuesOf('data-density')).toEqual(new Set(APPEARANCE_CHOICES.density));
    expect([...tokens.matchAll(/data-text-scale="(\w+)"\]\s*\{\s*font-size:\s*([\d.]+)%/g)].map((match) => [match[1], Number(match[2])])).toEqual([
      ['sm', 93.75],
      ['lg', 112.5],
      ['xl', 125],
    ]);
    expect(APPEARANCE_CHOICES.textSize.filter((size) => size !== 'md')).toEqual(['sm', 'lg', 'xl']);
  });

  test('`auto` density is compact under the media query Settings › Appearance describes', () => {
    expect(tokens).toMatch(new RegExp(`@media ${AUTO_COMPACT_QUERY.replace(/[()]/g, '\\$&')} \\{\\s*:root:not\\(\\[data-density\\]\\),\\s*\\[data-density="auto"\\]`));
  });
});

// The copy a device keeps in localStorage, so the page can apply it before any network answer and offline.
describe('the local copy', () => {
  const DARK_GOLD = { theme: 'dark', skin: 'gold', density: 'compact', textSize: 'lg' } as const;

  test('is read back with whether it still has to be saved; whatever is unusable falls back to the defaults, choice by choice', () => {
    expect(parseLocal(JSON.stringify({ appearance: DARK_GOLD, pending: true }))).toEqual({ appearance: DARK_GOLD, pending: true });
    expect(parseLocal(JSON.stringify({ appearance: DARK_GOLD }))).toEqual({ appearance: DARK_GOLD, pending: false });
    // A skin from some other version, a wrong type and a missing choice: each defaults, the rest are kept.
    expect(parseLocal(JSON.stringify({ appearance: { theme: 'dark', skin: 'neon', density: 7 }, pending: 'yes' }))).toEqual({
      appearance: { theme: 'dark', skin: 'desk', density: 'auto', textSize: 'md' },
      pending: false,
    });
  });

  test('is no copy at all when nothing was stored or what is stored is not an appearance', () => {
    for (const raw of [null, '', 'not json', '"dark"', 'null', '[]', '{}', '{"appearance":null}', '{"appearance":"dark"}']) {
      expect(parseLocal(raw), String(raw)).toBeUndefined();
    }
  });
});

// What a device does when Caduceus tells it what it has stored for the device.
describe('reconciling the local copy with the stored one', () => {
  const DARK_GOLD = { theme: 'dark', skin: 'gold', density: 'compact', textSize: 'lg' } as const;
  const LIGHT_MONO = { theme: 'light', skin: 'mono', density: 'comfortable', textSize: 'sm' } as const;
  const DEFAULTS = { theme: 'system', skin: 'desk', density: 'auto', textSize: 'md' } as const;

  test('a device with no local copy (its storage was cleared) takes the stored choices', () => {
    expect(reconcile(undefined, DARK_GOLD)).toEqual({ action: 'adopt', appearance: DARK_GOLD });
    // Nothing local and nothing stored: the defaults stay and nothing needs writing.
    expect(reconcile(undefined, null)).toEqual({ action: 'none' });
  });

  test('a change made here and not yet saved is sent, whatever Caduceus holds (it was made offline)', () => {
    expect(reconcile({ appearance: DARK_GOLD, pending: true }, LIGHT_MONO)).toEqual({ action: 'save', appearance: DARK_GOLD });
    expect(reconcile({ appearance: DARK_GOLD, pending: true }, null)).toEqual({ action: 'save', appearance: DARK_GOLD });
  });

  test('a saved copy that Caduceus has no record of (the browser forgot its device cookie) is sent, unless it is only the defaults', () => {
    expect(reconcile({ appearance: DARK_GOLD, pending: false }, null)).toEqual({ action: 'save', appearance: DARK_GOLD });
    expect(reconcile({ appearance: DEFAULTS, pending: false }, null)).toEqual({ action: 'none' });
  });

  test('a saved copy that differs from the stored choices gives way to them; one that matches needs nothing', () => {
    expect(reconcile({ appearance: DARK_GOLD, pending: false }, LIGHT_MONO)).toEqual({ action: 'adopt', appearance: LIGHT_MONO });
    expect(reconcile({ appearance: DARK_GOLD, pending: false }, DARK_GOLD)).toEqual({ action: 'none' });
  });
});

// "No flash of the wrong theme": the page's first lines set this device's appearance on <html> before any stylesheet or
// script of the bundle loads. The test runs the script `web/index.html` actually ships, against stand-ins for the page.
describe('the pre-paint script', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  /** Inline classic scripts: not the module entry. */
  const inlineScripts = [...html.matchAll(/<script(?![^>]*\b(?:src|type)=)[^>]*>([\s\S]*?)<\/script>/g)].map((match) => match[1]);

  /** The attributes the script leaves on <html> when `localStorage` holds `raw` under `key` (`'throws'`: storage is blocked). */
  function attributesAfterBoot(raw: string | null | 'throws', key = APPEARANCE_KEY): Record<string, string> {
    const attributes: Record<string, string> = {};
    const root = { setAttribute: (name: string, value: string) => void (attributes[name] = value), removeAttribute: (name: string) => void delete attributes[name] };
    const localStorage = {
      getItem(asked: string) {
        if (raw === 'throws') throw new DOMException('blocked', 'SecurityError');
        return asked === key ? raw : null;
      },
    };
    vm.runInNewContext(inlineScripts[0], { document: { documentElement: root }, localStorage });
    return attributes;
  }
  const present = (attributes: AppearanceAttributes) => Object.fromEntries(Object.entries(attributes).filter(([, value]) => value !== null));

  test('ships exactly one inline script, ahead of the bundle and of every stylesheet', () => {
    expect(inlineScripts).toHaveLength(1);
    expect(html.search(/<script(?![^>]*\b(?:src|type)=)/)).toBeLessThan(html.search(/<script[^>]*type="module"/));
    expect(html).not.toMatch(/<link[^>]*rel="stylesheet"/);
  });

  test('applies every combination of choices exactly as the app does', () => {
    for (const theme of APPEARANCE_CHOICES.theme)
      for (const skin of APPEARANCE_CHOICES.skin)
        for (const density of APPEARANCE_CHOICES.density)
          for (const textSize of APPEARANCE_CHOICES.textSize) {
            const appearance: Appearance = { theme, skin, density, textSize };
            expect(attributesAfterBoot(JSON.stringify({ appearance, pending: false })), JSON.stringify(appearance)).toEqual(present(attributesOf(appearance)));
          }
  });

  test('reads what the app stores, tolerates what it cannot use, and does nothing when there is nothing', () => {
    const stored = [
      null,
      '',
      'not json',
      '[]',
      '{}',
      '{"appearance":null}',
      '{"appearance":"dark"}',
      '{"appearance":{}}',
      '{"appearance":{"theme":"dark","skin":"neon","density":7,"textSize":"xxl"}}',
      '{"appearance":{"theme":"light"},"pending":true}',
    ];
    for (const raw of stored) {
      const local = parseLocal(raw);
      expect(attributesAfterBoot(raw), String(raw)).toEqual(local ? present(attributesOf(local.appearance)) : {});
    }
    // Blocked storage (a privacy mode) must not break the page.
    expect(attributesAfterBoot('throws')).toEqual({});
  });
});
