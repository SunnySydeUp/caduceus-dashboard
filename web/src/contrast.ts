// WCAG 2.2 contrast over the design tokens. Pure: it reads the text of `docs/design/tokens.css`, resolves a token the
// way a browser would for a given appearance (theme, skin, density) and pointer, and computes WCAG ratios. It runs in
// CI (`web/test/contrast.test.ts`), not in the app.
import type { Appearance } from '@caduceus/contracts/appearance';

/** An opaque sRGB colour, channels 0–255 (fractional after mixing). */
export interface Colour {
  r: number;
  g: number;
  b: number;
}

/** A `#rgb` or `#rrggbb` colour. */
export function parseColour(hex: string): Colour {
  const digits = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())?.[1];
  if (digits === undefined) throw new Error(`Not a hex colour: ${hex}`);
  const full = digits.length === 3 ? [...digits].map((digit) => digit + digit).join('') : digits;
  return { r: parseInt(full.slice(0, 2), 16), g: parseInt(full.slice(2, 4), 16), b: parseInt(full.slice(4, 6), 16) };
}

/** WCAG 2.x relative luminance. */
function luminance({ r, g, b }: Colour): number {
  const linear = (channel: number) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** The WCAG contrast ratio of two colours, from 1 to 21; the order does not matter. */
export function contrastRatio(a: Colour, b: Colour): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

// ---------------------------------------------------------------------------------------------------------------------
// Reading tokens.css
// ---------------------------------------------------------------------------------------------------------------------

/** What a page is showing on: the attributes on `<html>` (`undefined`: the attribute is absent), the OS and the device. */
export interface Environment extends Partial<Pick<Appearance, 'theme' | 'skin' | 'density'>> {
  /** Read the tokens of a descendant of `<html>` that carries these attributes (a skin card), not of `<html>` itself. */
  inside?: Partial<Pick<Appearance, 'theme' | 'skin' | 'density'>>;
  /** The operating system prefers dark (`prefers-color-scheme`). */
  prefersDark: boolean;
  pointer: 'fine' | 'coarse';
  /** The window's width in rem (media queries count rem as 16px, whatever the text size). */
  viewportRem: number;
}

interface Rule {
  selectors: string[];
  /** The `@media` condition the rule sits in. */
  media: string | undefined;
  declarations: Map<string, string>;
}

/** The rules of `tokens.css` in source order; at-rules other than `@media` (the Tailwind bridge) carry no cascade of tokens. */
export interface TokenSheet {
  rules: Rule[];
}

/** Splits at the commas (or `;`) that are not inside parentheses or brackets. */
function splitTopLevel(text: string, separator: ',' | ';'): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '(' || char === '[') depth++;
    else if (char === ')' || char === ']') depth--;
    else if (char === separator && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim()).filter((part) => part !== '');
}

function readRules(css: string, media: string | undefined, into: Rule[]): void {
  let at = 0;
  while (true) {
    const open = css.indexOf('{', at);
    if (open < 0) return;
    let depth = 1;
    let close = open + 1;
    for (; close < css.length && depth > 0; close++) depth += css[close] === '{' ? 1 : css[close] === '}' ? -1 : 0;
    const prelude = css.slice(at, open).trim();
    const body = css.slice(open + 1, close - 1);
    if (prelude.startsWith('@media')) readRules(body, prelude.slice('@media'.length).trim(), into);
    else if (!prelude.startsWith('@')) {
      const declarations = new Map<string, string>();
      for (const declaration of splitTopLevel(body, ';')) {
        const colon = declaration.indexOf(':');
        declarations.set(declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim());
      }
      into.push({ selectors: splitTopLevel(prelude, ','), media, declarations });
    }
    at = close;
  }
}

export function parseTokens(css: string): TokenSheet {
  const rules: Rule[] = [];
  readRules(css.replace(/\/\*[\s\S]*?\*\//g, ''), undefined, rules);
  return { rules };
}

const SIMPLE_SELECTOR = /:root|\[([\w-]+)(?:="([^"]*)")?\]|:not\(\[([\w-]+)(?:="([^"]*)")?\]\)/y;

/** The specificity of `selector` for an element with these attributes (`<html>` when `isRoot`), or `undefined` when it does not match. Only the selectors tokens.css uses. */
function specificity(selector: string, attributes: Record<string, string | undefined>, isRoot: boolean): number | undefined {
  // `:where(…)` matches like what is inside it and counts for nothing.
  if (selector.startsWith(':where(') && selector.endsWith(')')) return specificity(selector.slice(':where('.length, -1), attributes, isRoot) === undefined ? undefined : 0;
  let score = 0;
  SIMPLE_SELECTOR.lastIndex = 0;
  while (SIMPLE_SELECTOR.lastIndex < selector.length) {
    const part = SIMPLE_SELECTOR.exec(selector);
    if (part === null) throw new Error(`tokens.css uses a selector the contrast check cannot read: ${selector}`);
    const [text, name, value, notName, notValue] = part;
    score += 1;
    if (text === ':root') {
      if (!isRoot) return undefined;
      continue;
    }
    const matched = notName === undefined ? (value === undefined ? attributes[name] !== undefined : attributes[name] === value) : !(notValue === undefined ? attributes[notName] !== undefined : attributes[notName] === notValue);
    if (!matched) return undefined;
  }
  return score;
}

function mediaMatches(condition: string, environment: Environment): boolean {
  return condition.split(/\s+and\s+/).every((query) => {
    const [, feature, value] = /^\((\w[\w-]*):\s*([^)]+)\)$/.exec(query.trim()) ?? [];
    switch (feature) {
      case 'pointer':
        return environment.pointer === value;
      case 'min-width':
        return environment.viewportRem >= parseFloat(value);
      case 'prefers-reduced-motion':
        return false; // The checks here never ask for reduced motion.
      default:
        throw new Error(`tokens.css uses a media query the contrast check cannot read: ${query}`);
    }
  });
}

/** What the tokens come to for one page. */
export interface Tokens {
  /** The computed value of a custom property (or `color-scheme`) with every `var()` substituted. */
  value(name: string): string;
  colour(name: string): Colour;
  /** A length token in CSS pixels (`rem` at the browser's default 16px). */
  pixels(name: string): number;
}

export function tokensFor(sheet: TokenSheet, environment: Environment): Tokens {
  const attributesOf = (appearance: Partial<Pick<Appearance, 'theme' | 'skin' | 'density'>>) => ({ 'data-theme': appearance.theme, 'data-skin': appearance.skin, 'data-density': appearance.density });
  /** `<html>`, then (if asked) the descendant being read. Custom properties and `color-scheme` are inherited down this chain. */
  const elements = [attributesOf(environment), ...(environment.inside ? [attributesOf(environment.inside)] : [])];
  const reading = elements.length - 1;
  const rules = sheet.rules.filter((rule) => rule.media === undefined || mediaMatches(rule.media, environment));
  const computed = new Map<string, string>();

  /** The cascade on element `at`: the highest specificity wins, and among equals the last declaration in the file. */
  const declared = (name: string, at: number): string | undefined => {
    let winner: { score: number; value: string } | undefined;
    for (const rule of rules) {
      const value = rule.declarations.get(name);
      if (value === undefined) continue;
      const score = Math.max(-1, ...rule.selectors.map((selector) => specificity(selector, elements[at], at === 0) ?? -1));
      if (score >= 0 && (winner === undefined || score >= winner.score)) winner = { score, value };
    }
    return winner?.value;
  };

  /** A custom property's computed value on element `at`: declared there (with `var()` substituted from the same element), or inherited. */
  const value = (name: string, at: number): string => {
    const key = `${at}:${name}`;
    const known = computed.get(key);
    if (known !== undefined) return known;
    const raw = declared(name, at);
    if (raw === undefined && at === 0) throw new Error(`No value for ${name} (${JSON.stringify(environment)})`);
    const result = raw === undefined ? value(name, at - 1) : substitute(raw, at);
    computed.set(key, result);
    return result;
  };

  const substitute = (text: string, at: number): string => {
    let result = text;
    for (let start = result.indexOf('var('); start >= 0; start = result.indexOf('var(')) {
      let depth = 0;
      let end = start + 3;
      do depth += result[end] === '(' ? 1 : result[end] === ')' ? -1 : 0;
      while (depth > 0 && ++end < result.length);
      const reference = result.slice(start + 4, end).trim();
      if (!reference.startsWith('--') || reference.includes(',')) throw new Error(`The contrast check reads only var(--name): ${result.slice(start, end + 1)}`);
      result = result.slice(0, start) + value(reference, at) + result.slice(end + 1);
    }
    return result;
  };

  /** `color-scheme` is inherited, so the nearest element that declares it decides. */
  const scheme = (): 'light' | 'dark' => {
    let declaredScheme = 'light dark';
    for (let at = reading; at >= 0; at--) {
      const own = declared('color-scheme', at);
      if (own !== undefined) {
        declaredScheme = own;
        break;
      }
    }
    return declaredScheme === 'dark' || (declaredScheme.includes('dark') && declaredScheme.includes('light') && environment.prefersDark) ? 'dark' : 'light';
  };

  const colour = (expression: string): Colour => {
    const text = expression.trim();
    if (text.startsWith('#')) return parseColour(text);
    const call = /^([\w-]+)\(([\s\S]*)\)$/.exec(text);
    if (call?.[1] === 'light-dark') {
      const [light, dark] = splitTopLevel(call[2], ',');
      return colour(scheme() === 'dark' ? dark : light);
    }
    if (call?.[1] === 'color-mix') {
      const [space, first, second] = splitTopLevel(call[2], ',');
      if (space !== 'in srgb') throw new Error(`The contrast check mixes only in srgb: ${text}`);
      const weighted = (part: string) => {
        const [, mixed, percent] = /^([\s\S]*?)(?:\s+(\d+(?:\.\d+)?)%)?$/.exec(part)!;
        return { colour: colour(mixed), weight: percent === undefined ? undefined : Number(percent) / 100 };
      };
      const [a, b] = [weighted(first), weighted(second)];
      const weightA = a.weight ?? (b.weight === undefined ? 0.5 : 1 - b.weight);
      const weightB = b.weight ?? 1 - weightA;
      if (Math.abs(weightA + weightB - 1) > 1e-9) throw new Error(`The contrast check mixes only opaque weights that add to 100%: ${text}`);
      // Pixels are 8-bit, so a mixed colour is rounded to the colour that is painted (design-system §4.4 does the same).
      const mix = (channel: keyof Colour) => Math.round(a.colour[channel] * weightA + b.colour[channel] * weightB);
      return { r: mix('r'), g: mix('g'), b: mix('b') };
    }
    throw new Error(`The contrast check cannot read this colour: ${text}`);
  };

  return {
    value: (name) => (name === 'color-scheme' ? scheme() : value(name, reading)),
    colour: (name) => colour(value(name, reading)),
    pixels(name) {
      const [, amount, unit] = /^(-?[\d.]+)(rem|px)$/.exec(value(name, reading)) ?? [];
      if (amount === undefined) throw new Error(`${name} is not a length: ${value(name, reading)}`);
      return Number(amount) * (unit === 'rem' ? 16 : 1);
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// The pairs of design-system §4.4
// ---------------------------------------------------------------------------------------------------------------------

/** A token used as the foreground on a token used as the background, and the least ratio WCAG 2.2 AA asks of it. */
export interface ContrastPair {
  /** Which documented row this belongs to. */
  group: string;
  foreground: string;
  background: string;
  /** 4.5 for text (1.4.3); 3 for what is not text but must be seen: control borders, the focus ring, status dots, chart series (1.4.11). */
  minimum: 4.5 | 3;
}

export interface MeasuredPair extends ContrastPair {
  ratio: number;
}

const bg = (...names: string[]) => names.map((name) => `--cd-bg-${name}`);
/** Where body text, accents and status text sit. */
const SURFACES = bg('canvas', 'sidebar', 'surface', 'surface-2', 'overlay', 'inset', 'input');
/** Where charts are drawn. */
const CHART_SURFACES = bg('canvas', 'surface', 'surface-2', 'overlay');
const TONES = ['neutral', 'info', 'success', 'warning', 'danger', 'running', 'paused', 'stale', 'blocked'];

function pairs(group: string, foregrounds: string[], backgrounds: string[], minimum: ContrastPair['minimum']): ContrastPair[] {
  return foregrounds.flatMap((foreground) => backgrounds.map((background) => ({ group, foreground, background, minimum })));
}

export const CONTRAST_PAIRS: ContrastPair[] = [
  // Neutrals: text on every surface, and the borders of controls on every surface.
  ...['default', 'muted', 'subtle'].flatMap((tier) => pairs(`fg-${tier} on surfaces`, [`--cd-fg-${tier}`], SURFACES, 4.5)),
  // Metadata on a selected row (the row tints 8% of the accent).
  ...pairs('fg-subtle on selected row', ['--cd-fg-subtle'], ['--cd-bg-selected'], 4.5),
  ...pairs('border-control on surfaces', ['--cd-border-control'], SURFACES, 3),
  // The accent: as text, as a fill carrying text, on its tint, and as the focus ring.
  ...pairs('accent-fg on surfaces', ['--cd-accent-fg'], SURFACES, 4.5),
  ...pairs('accent-fg on accent-soft', ['--cd-accent-fg'], ['--cd-accent-soft'], 4.5),
  ...pairs('on-accent on accent', ['--cd-on-accent'], ['--cd-accent'], 4.5),
  ...pairs('focus-ring on surfaces', ['--cd-focus-ring'], SURFACES, 3),
  // Every status tone: its text on the surfaces and on its tint, its dot on the surfaces, and text on its dot.
  ...TONES.flatMap((tone) => [
    ...pairs(`${tone}: fg on surfaces`, [`--cd-tone-${tone}-fg`], SURFACES, 4.5),
    ...pairs(`${tone}: fg on soft`, [`--cd-tone-${tone}-fg`], [`--cd-tone-${tone}-soft`], 4.5),
    ...pairs(`${tone}: solid on surfaces`, [`--cd-tone-${tone}-solid`], SURFACES, 3),
    ...pairs(`${tone}: on solid`, [`--cd-tone-${tone}-on`], [`--cd-tone-${tone}-solid`], 4.5),
  ]),
  // Charts: every series, and the axis labels, on the surfaces a chart sits on.
  ...pairs('viz on chart surfaces', ['1', '2', '3', '4', '5', '6', 'other'].map((name) => `--cd-viz-${name}`), CHART_SURFACES, 3),
  ...pairs('viz-axis on chart surfaces', ['--cd-viz-axis'], CHART_SURFACES, 4.5),
  // A sigil: each hue's cells on that hue's own tile (a graphic, so 3:1).
  ...[1, 2, 3, 4, 5, 6, 7].flatMap((n) => pairs('sigil on sigil tile', [`--cd-sigil-${n}`], [`--cd-sigil-tile-${n}`], 3)),
  ...pairs('code on inset and surface', ['keyword', 'string', 'number', 'comment', 'function', 'type', 'punct'].map((name) => `--cd-code-${name}`), bg('inset', 'surface'), 4.5),
  // A diff line: its sign and text, and the muted gutter numbers, on the line's tint.
  ...pairs('diff text on diff', ['--cd-diff-add-fg', '--cd-fg-subtle'], ['--cd-diff-add-bg'], 4.5),
  ...pairs('diff text on diff', ['--cd-diff-remove-fg', '--cd-fg-subtle'], ['--cd-diff-remove-bg'], 4.5),
];

/** The pairs of one page that fall below their minimum, with the ratio each one has. */
export function contrastFailures(tokens: Tokens): MeasuredPair[] {
  return CONTRAST_PAIRS.map((pair) => ({ ...pair, ratio: contrastRatio(tokens.colour(pair.foreground), tokens.colour(pair.background)) })).filter((pair) => pair.ratio < pair.minimum);
}
