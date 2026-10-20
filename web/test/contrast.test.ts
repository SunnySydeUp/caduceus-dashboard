import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import { APPEARANCE_CHOICES } from '@caduceus/contracts/appearance';
import { CONTRAST_PAIRS, contrastFailures, contrastRatio, parseColour, parseTokens, tokensFor, type Colour, type Environment, type Tokens } from '../src/contrast.ts';

const sheet = parseTokens(fs.readFileSync(new URL('../../docs/design/tokens.css', import.meta.url), 'utf8'));
const environment = (change: Partial<Environment> = {}): Environment => ({ theme: 'light', skin: 'nous', density: 'auto', prefersDark: false, pointer: 'fine', viewportRem: 90, ...change });
const rgb = ({ r, g, b }: Colour) => [r, g, b].map((channel) => Math.round(channel * 100) / 100);

// WCAG 2.2 contrast over the design tokens (docs/design/tokens.css), computed from the token values.
describe('contrast ratio', () => {
  test('follows WCAG 2.x relative luminance', () => {
    // WCAG's own extremes, and the well-known grey that just passes 4.5:1 on white.
    expect(contrastRatio(parseColour('#000000'), parseColour('#ffffff'))).toBeCloseTo(21, 5);
    expect(contrastRatio(parseColour('#ffffff'), parseColour('#ffffff'))).toBeCloseTo(1, 5);
    expect(contrastRatio(parseColour('#767676'), parseColour('#ffffff'))).toBeCloseTo(4.54, 2);
    expect(contrastRatio(parseColour('#777777'), parseColour('#ffffff'))).toBeCloseTo(4.48, 2);
    // Symmetric: the order of the two colours does not matter.
    expect(contrastRatio(parseColour('#fff'), parseColour('#767676'))).toBeCloseTo(4.54, 2);
  });
});

// A token's colour for one appearance, the way the browser resolves tokens.css: the cascade of `:root` and the skin, `light-dark()`, `var()` and `color-mix()`.
describe('resolving a colour token', () => {
  test('a plain token is the light or the dark half of its light-dark() pair', () => {
    expect(rgb(tokensFor(sheet, environment({ theme: 'light' })).colour('--cd-accent'))).toEqual([0, 83, 253]); // #0053fd
    expect(rgb(tokensFor(sheet, environment({ theme: 'dark' })).colour('--cd-accent'))).toEqual([74, 132, 254]); // #4a84fe
  });

  test('`system` follows the operating system, and an explicit theme ignores it', () => {
    const canvas = (change: Partial<Environment>) => rgb(tokensFor(sheet, environment(change)).colour('--cd-bg-canvas'));

    expect(canvas({ theme: 'system', prefersDark: true })).toEqual([14, 16, 20]); // #0e1014
    expect(canvas({ theme: 'system', prefersDark: false })).toEqual([246, 247, 249]); // #f6f7f9
    expect(canvas({ theme: 'light', prefersDark: true })).toEqual([246, 247, 249]);
    expect(canvas({ theme: 'dark', prefersDark: false })).toEqual([14, 16, 20]);
  });

  test('a skin overrides what it declares and leaves the rest as it was', () => {
    const token = (skin: Environment['skin'], theme: Environment['theme'], name: string) => rgb(tokensFor(sheet, environment({ skin, theme })).colour(name));

    expect(token('hermes', 'light', '--cd-bg-canvas')).toEqual([251, 246, 238]); // #fbf6ee
    expect(token('hermes', 'dark', '--cd-bg-canvas')).toEqual([4, 28, 28]); // #041c1c
    expect(token('gold', 'dark', '--cd-accent')).toEqual([255, 215, 0]); // #ffd700
    expect(token('gold', 'dark', '--cd-bg-canvas')).toEqual([14, 16, 20]); // gold keeps Nous's neutrals
  });

  test('a derived token is recomputed from the skin and theme it is read in', () => {
    // accent-soft is 12% accent over the surface: 0.12 × accent + 0.88 × surface per channel in sRGB, rounded to the 8-bit pixel.
    expect(rgb(tokensFor(sheet, environment({ theme: 'light', skin: 'nous' })).colour('--cd-accent-soft'))).toEqual([224, 234, 255]); // 224.4, 234.36, 254.76: #0053fd over #ffffff
    expect(rgb(tokensFor(sheet, environment({ theme: 'dark', skin: 'hermes' })).colour('--cd-accent-soft'))).toEqual([39, 55, 39]); // 39.4, 55.24, 39.28: #ffbd38 over #0a2525
  });
});

// The ratios design-system §4.4 records (computed there with other tooling, from the same token hexes and color-mix
// results) are the independent source for the resolver and the ratio maths: the engine must reproduce them.
describe('reproducing the evidence in design-system §4.4', () => {
  const SURFACES = ['canvas', 'sidebar', 'surface', 'surface-2', 'overlay', 'inset'].map((name) => `--cd-bg-${name}`);
  const BORDER_SURFACES = ['canvas', 'surface', 'surface-2', 'inset'].map((name) => `--cd-bg-${name}`);
  const CHART_SURFACES = ['canvas', 'surface', 'surface-2'].map((name) => `--cd-bg-${name}`);
  const SKINS = ['desk', 'nous', 'hermes', 'gold', 'cherenkov', 'verdant', 'mono'] as const;
  const TONES = ['neutral', 'info', 'success', 'warning', 'danger', 'running', 'paused', 'stale', 'blocked'];

  /** Light, then dark. */
  type Ratios = [number, number];
  /** The lowest ratio of `foreground` over each of `backgrounds`, in light then dark, for one skin. */
  function worst(skin: Environment['skin'], foregrounds: string[], backgrounds: string[]): Ratios {
    const lowest = (theme: 'light' | 'dark') => {
      const tokens: Tokens = tokensFor(sheet, environment({ theme, skin }));
      return Math.min(...foregrounds.flatMap((foreground) => backgrounds.map((background) => contrastRatio(tokens.colour(foreground), tokens.colour(background)))));
    };
    return [lowest('light'), lowest('dark')];
  }
  const expectRatios = (actual: Ratios, expected: Ratios, label: string) => {
    expect(actual[0], `${label} light`).toBeCloseTo(expected[0], 2);
    expect(actual[1], `${label} dark`).toBeCloseTo(expected[1], 2);
  };

  test('text and control borders on the neutral surfaces, in Nous and in Hermes Teal', () => {
    expectRatios(worst('nous', ['--cd-fg-default'], SURFACES), [15.72, 13.57], 'nous fg-default');
    expectRatios(worst('nous', ['--cd-fg-muted'], SURFACES), [7.33, 8.38], 'nous fg-muted');
    expectRatios(worst('nous', ['--cd-fg-subtle'], SURFACES), [5.0, 5.41], 'nous fg-subtle');
    expectRatios(worst('nous', ['--cd-border-control'], BORDER_SURFACES), [3.26, 3.51], 'nous border-control');
    expectRatios(worst('hermes', ['--cd-fg-default'], SURFACES), [14.23, 11.88], 'teal fg-default');
    expectRatios(worst('hermes', ['--cd-fg-muted'], SURFACES), [7.69, 9.28], 'teal fg-muted');
    expectRatios(worst('hermes', ['--cd-fg-subtle'], SURFACES), [5.11, 6.04], 'teal fg-subtle');
    expectRatios(worst('hermes', ['--cd-border-control'], BORDER_SURFACES), [3.05, 3.64], 'teal border-control');
  });

  test('every skin: the accent as text, text on the accent, and the accent as text on its soft tint', () => {
    // Per skin, light / dark: accent-fg on the surfaces, on-accent on the accent fill, accent-fg on accent-soft.
    const recorded: Record<(typeof SKINS)[number], [Ratios, Ratios, Ratios]> = {
      desk: [[16.14, 14.06], [18.77, 16.72], [14.6, 11.22]],
      nous: [[6.34, 7.4], [5.74, 5.57], [5.99, 6.95]],
      hermes: [[5.49, 9.31], [5.47, 11.11], [5.37, 8.22]],
      gold: [[5.71, 11.65], [5.3, 13.53], [5.56, 9.65]],
      cherenkov: [[5.8, 10.06], [5.07, 8.87], [5.59, 8.96]],
      verdant: [[6.27, 8.16], [6.42, 5.8], [5.97, 7.6]],
      mono: [[12.95, 13.57], [14.77, 15.81], [11.73, 10.84]],
    };
    for (const skin of SKINS) {
      const [accentFg, onAccent, onSoft] = recorded[skin];
      expectRatios(worst(skin, ['--cd-accent-fg'], SURFACES), accentFg, `${skin} accent-fg on surfaces`);
      expectRatios(worst(skin, ['--cd-on-accent'], ['--cd-accent']), onAccent, `${skin} on-accent`);
      expectRatios(worst(skin, ['--cd-accent-fg'], ['--cd-accent-soft']), onSoft, `${skin} accent-fg on accent-soft`);
    }
  });

  test('every status tone: its text, its text on its tint, its dot on the surfaces, and text on its dot', () => {
    // Per tone, light / dark: fg on the surfaces, fg on its soft tint, solid on canvas, surface and surface-2, on-solid on solid.
    const recorded: [Ratios, Ratios, Ratios, Ratios][] = [
      [[6.38, 8.38], [6.11, 7.4], [4.3, 5.41], [4.78, 6.44]], // neutral
      [[5.57, 7.6], [5.27, 6.75], [4.29, 5.39], [4.77, 6.41]], // info
      [[5.33, 8.85], [5.04, 7.64], [4.49, 6.7], [5.0, 7.97]], // success
      [[5.55, 10.14], [5.4, 8.54], [3.41, 8.01], [4.73, 9.52]], // warning
      [[5.69, 7.26], [5.3, 6.69], [4.34, 4.91], [4.83, 5.84]], // danger
      [[5.56, 9.3], [5.35, 8.06], [3.53, 6.9], [4.57, 8.2]], // running
      [[6.23, 7.86], [5.93, 6.99], [4.48, 5.53], [4.98, 6.58]], // paused
      [[5.62, 9.37], [5.53, 8.13], [3.26, 6.5], [4.95, 7.73]], // stale
      [[5.58, 8.33], [5.24, 7.39], [4.3, 5.89], [4.78, 7.01]], // blocked
    ];
    TONES.forEach((tone, index) => {
      const [fg, onSoft, solid, on] = recorded[index];
      expectRatios(worst('nous', [`--cd-tone-${tone}-fg`], SURFACES), fg, `${tone} fg`);
      expectRatios(worst('nous', [`--cd-tone-${tone}-fg`], [`--cd-tone-${tone}-soft`]), onSoft, `${tone} fg on soft`);
      expectRatios(worst('nous', [`--cd-tone-${tone}-solid`], CHART_SURFACES), solid, `${tone} solid`);
      expectRatios(worst('nous', [`--cd-tone-${tone}-on`], [`--cd-tone-${tone}-solid`]), on, `${tone} on solid`);
    });
  });

  test('the chart palette, the sigils, the code colours, selected rows and the status text in Hermes Teal', () => {
    const viz = ['1', '2', '3', '4', '5', '6'].map((n) => `--cd-viz-${n}`);
    expectRatios(worst('nous', viz, CHART_SURFACES), [3.2, 4.5], 'viz vs canvas, surface and surface-2 (Nous)');
    // Hermes Teal's cream and teal surfaces are the hardest for the chart colours: over every skin the series still clear 3:1.
    const everySkin = SKINS.map((skin) => worst(skin, viz, [...CHART_SURFACES, '--cd-bg-overlay']));
    expectRatios([Math.min(...everySkin.map(([light]) => light)), Math.min(...everySkin.map(([, dark]) => dark))], [3.03, 3.94], 'viz on every skin');
    // Each hue of a sigil on its own tile (the hue at 17% over the surface); the lowest is the blue one in light and the indigo one in dark.
    const sigils = [1, 2, 3, 4, 5, 6, 7].map((n) => worst('nous', [`--cd-sigil-${n}`], [`--cd-sigil-tile-${n}`]));
    expectRatios([Math.min(...sigils.map(([light]) => light)), Math.min(...sigils.map(([, dark]) => dark))], [3.92, 5.21], 'sigil hues on their tiles');
    const code = ['keyword', 'string', 'number', 'comment', 'function', 'type', 'punct'].map((name) => `--cd-code-${name}`);
    expectRatios(worst('nous', code, ['--cd-bg-inset', '--cd-bg-surface']), [4.9, 5.89], 'code colours on inset and surface');
    // "fg-subtle metadata on a selected row is >= 4.83 in every skin": 4.83 is also the lowest, so the bound is tight.
    const selected = SKINS.flatMap((skin) => worst(skin, ['--cd-fg-subtle'], ['--cd-bg-selected']));
    expect(Math.min(...selected)).toBeCloseTo(4.83, 2);
    // "Status fg on Teal surfaces: >= 5.18 / 6.35".
    expectRatios(worst('hermes', TONES.map((tone) => `--cd-tone-${tone}-fg`), SURFACES), [5.18, 6.35], 'teal status text');
  });
});

// The CI gate of M0 #07: every appearance a device can choose passes the WCAG 2.2 AA pairs of design-system §4.4.
describe('contrast of every appearance', () => {
  /** What the choices meet on a device: a mouse on a wide window (where `auto` density is compact), on a narrow one, and a touch screen. */
  const DEVICES = [
    { pointer: 'fine', viewportRem: 90 },
    { pointer: 'fine', viewportRem: 40 },
    { pointer: 'coarse', viewportRem: 90 },
  ] as const;

  /** Every theme, skin and density, with `system` once under a light OS and once under a dark one, on every device; plus a first visit, before anything is stored (no attributes). */
  function* everyEnvironment(): Generator<Environment> {
    for (const device of DEVICES)
      for (const prefersDark of [false, true])
        for (const theme of APPEARANCE_CHOICES.theme)
          for (const skin of APPEARANCE_CHOICES.skin)
            for (const density of APPEARANCE_CHOICES.density) if (prefersDark === false || theme === 'system') yield { theme, skin, density, prefersDark, ...device };
    for (const device of DEVICES) for (const prefersDark of [false, true]) yield { prefersDark, ...device };
  }
  const describeEnvironment = (e: Environment) => `${e.theme ?? '(none)'}${e.theme === 'system' ? (e.prefersDark ? ' (OS dark)' : ' (OS light)') : ''} / ${e.skin ?? '(none)'} / ${e.density ?? '(none)'} / ${e.pointer} ${e.viewportRem}rem`;

  test('no pair falls below its minimum, in any theme, skin and density', () => {
    let checked = 0;
    const failures: string[] = [];
    for (const environment of everyEnvironment()) {
      checked++;
      for (const failure of contrastFailures(tokensFor(sheet, environment))) {
        failures.push(`${describeEnvironment(environment)}: ${failure.group}: ${failure.foreground} on ${failure.background} is ${failure.ratio.toFixed(2)}:1, needs ${failure.minimum}:1`);
      }
    }

    expect(failures).toEqual([]);
    // 4 themes (system under both OS settings) × 7 skins × 3 densities × 3 devices, and the first visit, 2 × 3.
    expect(checked).toBe(4 * 7 * 3 * 3 + 2 * 3);
  });

  test('the pairs cover what design-system §4.4 documents', () => {
    const groups = new Set(CONTRAST_PAIRS.map((pair) => pair.group));

    for (const documented of [
      'fg-default on surfaces',
      'fg-muted on surfaces',
      'fg-subtle on surfaces',
      'fg-subtle on selected row',
      'border-control on surfaces',
      'accent-fg on surfaces',
      'accent-fg on accent-soft',
      'on-accent on accent',
      'focus-ring on surfaces',
      'viz on chart surfaces',
      'sigil on sigil tile',
      'code on inset and surface',
      'diff text on diff',
      ...['neutral', 'info', 'success', 'warning', 'danger', 'running', 'paused', 'stale', 'blocked'].flatMap((tone) => [`${tone}: fg on surfaces`, `${tone}: fg on soft`, `${tone}: solid on surfaces`, `${tone}: on solid`]),
    ]) {
      expect(groups, documented).toContain(documented);
    }
    // Text pairs need 4.5:1; borders, the focus ring and status dots, which are not text, 3:1 (WCAG 1.4.3, 1.4.11).
    expect(Object.fromEntries(['fg-subtle on surfaces', 'on-accent on accent', 'border-control on surfaces', 'focus-ring on surfaces', 'neutral: solid on surfaces'].map((group) => [group, CONTRAST_PAIRS.find((pair) => pair.group === group)!.minimum]))).toEqual({
      'fg-subtle on surfaces': 4.5,
      'on-accent on accent': 4.5,
      'border-control on surfaces': 3,
      'focus-ring on surfaces': 3,
      'neutral: solid on surfaces': 3,
    });
  });

  test('a pair that falls below its minimum is reported, with the pair and the ratio', () => {
    // Nous's light fg-subtle is #5f6775 (5.0:1 on the worst surface); #9aa1ad (the disabled grey) is about 2.3:1.
    const css = fs.readFileSync(new URL('../../docs/design/tokens.css', import.meta.url), 'utf8');
    const weakened = css.replace('--cd-fg-subtle: light-dark(#5f6775, #8d95a2)', '--cd-fg-subtle: light-dark(#9aa1ad, #8d95a2)');
    expect(weakened).not.toBe(css);
    const weak = parseTokens(weakened);

    const light = contrastFailures(tokensFor(weak, environment({ theme: 'light' })));
    expect(new Set(light.map((failure) => failure.foreground))).toEqual(new Set(['--cd-fg-subtle']));
    expect(light.map((failure) => failure.group)).toContain('fg-subtle on surfaces');
    expect(light.every((failure) => failure.ratio < failure.minimum)).toBe(true);
    // The dark half of the pair is untouched.
    expect(contrastFailures(tokensFor(weak, environment({ theme: 'dark' })))).toEqual([]);
  });
});

// Density changes how big controls are, never what colour anything is; and a coarse pointer always keeps 44px targets.
describe('density and touch targets', () => {
  /** A control's block size: `min-block-size: max(var(--cd-control-h), var(--cd-target-min))`, in CSS pixels. */
  const controlSize = (tokens: Tokens) => Math.max(tokens.pixels('--cd-control-h'), tokens.pixels('--cd-target-min'));
  const on = (density: Environment['density'], pointer: Environment['pointer'], viewportRem: number) => tokensFor(sheet, environment({ density, pointer, viewportRem }));

  test('changing density resizes controls under a mouse; a touch screen keeps every control at least 44px whatever the density', () => {
    // Fine pointer: comfortable 44, compact 32; `auto` is compact only from 64rem up.
    expect(controlSize(on('comfortable', 'fine', 90))).toBe(44);
    expect(controlSize(on('compact', 'fine', 90))).toBe(32);
    expect(controlSize(on('auto', 'fine', 64))).toBe(32);
    expect(controlSize(on('auto', 'fine', 63.99))).toBe(44);
    // Coarse pointer: the hit area is raised to 44px in every density, for every control size.
    for (const density of APPEARANCE_CHOICES.density) {
      expect(on(density, 'coarse', 90).pixels('--cd-target-min'), density).toBe(44);
      expect(controlSize(on(density, 'coarse', 90)), density).toBe(44);
      expect(on(density, 'fine', 90).pixels('--cd-target-min'), density).toBe(24);
    }
  });

  test('in every density the smallest control is still 24px, the WCAG 2.5.8 minimum', () => {
    for (const density of APPEARANCE_CHOICES.density)
      for (const name of ['--cd-control-h', '--cd-control-h-sm', '--cd-control-h-lg']) expect(on(density, 'fine', 90).pixels(name), `${density} ${name}`).toBeGreaterThanOrEqual(24);
  });

  test('a first visit, with no attributes on <html>, looks exactly like the defaults chosen explicitly', () => {
    const names = [...new Set(sheet.rules.flatMap((rule) => [...rule.declarations.keys()]))].filter((name) => name.startsWith('--cd-'));
    for (const device of [{ pointer: 'fine', viewportRem: 90 }, { pointer: 'fine', viewportRem: 40 }, { pointer: 'coarse', viewportRem: 90 }] as const)
      for (const prefersDark of [false, true]) {
        const first = tokensFor(sheet, { prefersDark, ...device });
        const chosen = tokensFor(sheet, { theme: 'system', skin: 'desk', density: 'auto', prefersDark, ...device });
        for (const name of names) expect(first.value(name), `${name} ${JSON.stringify(device)} dark=${prefersDark}`).toBe(chosen.value(name));
      }
  });

  test('density changes only the tokens its own blocks declare, and none of them is a colour', () => {
    const densityTokens = new Set(sheet.rules.filter((rule) => rule.selectors.some((selector) => /\[data-density="/.test(selector))).flatMap((rule) => [...rule.declarations.keys()]));
    // Sanity: the density blocks declare sizes, not colours.
    expect([...densityTokens].some((name) => /bg|fg|border|accent|tone|viz|shadow/.test(name))).toBe(false);
    const names = [...new Set(sheet.rules.flatMap((rule) => [...rule.declarations.keys()]))].filter((name) => name.startsWith('--cd-'));
    for (const skin of APPEARANCE_CHOICES.skin)
      for (const theme of ['light', 'dark'] as const) {
        const comfortable = tokensFor(sheet, environment({ theme, skin, density: 'comfortable' }));
        const compact = tokensFor(sheet, environment({ theme, skin, density: 'compact' }));
        const differs = names.filter((name) => comfortable.value(name) !== compact.value(name));
        // The two do differ (sizes), and only in tokens the density blocks declare.
        expect(differs).toContain('--cd-control-h');
        expect(differs.filter((name) => !densityTokens.has(name)), `${skin} ${theme}`).toEqual([]);
      }
  });
});

// Every axis also works on a subtree (design-system §4.1): the skin cards of Settings › Appearance each carry their skin.
describe('a subtree that names its own appearance', () => {
  const SKINS = APPEARANCE_CHOICES.skin;
  /** The colour tokens skins and themes change, including the ones derived from them. */
  const colourNames = [...new Set(sheet.rules.flatMap((rule) => [...rule.declarations.keys()]))].filter((name) => /^--cd-(bg-.+|fg-.+|border-(subtle|default|control|strong)|accent.*|on-accent|focus-ring|selection|tone-.+)$/.test(name));

  test('a skin card shows its own skin whichever skin the page uses, Nous included', () => {
    for (const page of SKINS)
      for (const card of SKINS) {
        const inside = tokensFor(sheet, environment({ theme: 'light', skin: page, inside: { skin: card } }));
        const alone = tokensFor(sheet, environment({ theme: 'light', skin: card }));
        for (const name of colourNames) expect(rgb(inside.colour(name)), `${card} card on a ${page} page: ${name}`).toEqual(rgb(alone.colour(name)));
        // Shape and type follow the skin too: Mono is square, Hermes Teal sets the display face.
        for (const name of ['--cd-radius-scale', '--cd-font-display']) expect(inside.value(name), `${card} card on a ${page} page: ${name}`).toBe(alone.value(name));
      }
  });

  test('a card that names a theme shows that theme, in every skin', () => {
    for (const skin of SKINS)
      for (const [page, card] of [['light', 'dark'], ['dark', 'light']] as const) {
        const inside = tokensFor(sheet, environment({ theme: page, skin, inside: { theme: card } }));
        const alone = tokensFor(sheet, environment({ theme: card, skin }));
        for (const name of colourNames) expect(rgb(inside.colour(name)), `${card} card on a ${page} ${skin} page: ${name}`).toEqual(rgb(alone.colour(name)));
      }
  });
});
