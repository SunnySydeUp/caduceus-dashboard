// `npm run lint:ui`: the design system's lint gates over the web app (mobile spec §11, AGENTS.md "Code rules").
//
//   raw-colour   CSS and TS/TSX use only `--cd-*` tokens: no hex, `rgb()`-style or named colours.
//   vh           no `vh` units (use `dvh`, `svh` or `lvh`): `100vh` is wrong under a mobile browser's moving toolbars.
//   icon-button  a button, or anything styled `btn--icon`, that shows only an icon needs an accessible name.
//   zoom-lock    the viewport meta never disables zoom (WCAG 1.4.4).
//   motion       reduced motion is respected everywhere (WCAG 2.3.3): durations come from the `--cd-dur-*` tokens, which
//                `tokens.css` zeroes under `prefers-reduced-motion`; an animation that loops or has a literal duration is
//                switched off there (`animation: none`); no smooth scrolling, in CSS or in `scrollTo` / `scrollIntoView` options.
//
// It is tooling, not a test seam: it reads `web/src` and `web/index.html` and exits 1 listing every finding.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAst } from 'rolldown/parseAst';
import { parseTokens } from '../../web/src/contrast.ts';

const WEB = fileURLToPath(new URL('../../web', import.meta.url));

interface Finding {
  file: string;
  line: number;
  rule: 'raw-colour' | 'vh' | 'icon-button' | 'zoom-lock' | 'motion';
  message: string;
}

/** The CSS named colours (CSS Color 4) except `transparent` and `currentcolor`, which are not palette choices. */
const NAMED_COLOURS = new Set(
  (
    'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan ' +
    'darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey ' +
    'darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink ' +
    'indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen ' +
    'lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue ' +
    'mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise ' +
    'palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray ' +
    'slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen'
  ).split(' '),
);

const HEX_COLOUR = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{4}|[0-9a-f]{3})(?![0-9a-z_-])/i;
const COLOUR_FUNCTION = /(?<![\w-])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i;
const VH_UNIT = /(?<![\w.-])\d*\.?\d+vh(?![\w-])/i;

const lineOf = (text: string, offset: number) => text.slice(0, offset).split('\n').length;

function lintCss(file: string, css: string): Finding[] {
  const findings: Finding[] = [];
  // Comments become spaces, so offsets (and so line numbers) stay put.
  const text = css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));
  // Every `property: value` pair; values never contain `;`, `{` or `}` outside strings and `url()`.
  for (const match of text.matchAll(/(?<![\w-])([\w-]+)\s*:\s*([^;{}]+)/g)) {
    const [, property, rawValue] = match;
    const line = lineOf(text, match.index);
    // Quoted strings (`content: "x"`, font names, grid areas) and urls are not colours.
    const value = rawValue.replace(/"[^"]*"|'[^']*'|url\([^)]*\)/g, ' ');
    if (HEX_COLOUR.test(value) || COLOUR_FUNCTION.test(value)) findings.push({ file, line, rule: 'raw-colour', message: `${property}: ${rawValue.trim()} (use a --cd-* colour token)` });
    else if (value.split(/[^a-z-]+/i).some((word) => NAMED_COLOURS.has(word.toLowerCase()))) findings.push({ file, line, rule: 'raw-colour', message: `${property}: ${rawValue.trim()} (named colour; use a --cd-* colour token)` });
    if (VH_UNIT.test(value)) findings.push({ file, line, rule: 'vh', message: `${property}: ${rawValue.trim()} (use dvh, svh or lvh)` });
  }
  return findings;
}

const LITERAL_DURATION = /(?<![\w.-])\d*\.?\d+m?s(?![\w-])/;
const REDUCED_MOTION = /prefers-reduced-motion:\s*reduce/;

/**
 * Reduced motion across every stylesheet. `tokens.css` zeroes every `--cd-dur-*` under `prefers-reduced-motion`, so a
 * transition or animation that takes its time from them stops by itself. The ways around that are checked: a literal
 * duration in a transition, an animation with a literal duration or a loop (it must be switched off under reduced motion, in
 * any stylesheet), and smooth scrolling.
 */
function lintMotion(sheets: { file: string; css: string }[]): Finding[] {
  const parsed = sheets.map(({ file, css }) => ({ file, css, rules: parseTokens(css).rules }));
  const normal = (selector: string) => selector.replace(/\s+/g, ' ').trim();
  const switchedOff = new Set(
    parsed.flatMap(({ rules }) =>
      rules.filter((rule) => rule.media !== undefined && REDUCED_MOTION.test(rule.media) && /^none\b/.test(rule.declarations.get('animation') ?? '')).flatMap((rule) => rule.selectors.map(normal)),
    ),
  );
  const withoutTokens = (value: string) => value.replace(/var\([^)]*\)/g, ' ');
  const findings: Finding[] = [];
  for (const { file, css, rules } of parsed) {
    const report = (declaration: string, value: string, message: string) => {
      const at = css.indexOf(value, css.indexOf(declaration));
      findings.push({ file, line: lineOf(css, Math.max(at, 0)), rule: 'motion', message });
    };
    for (const rule of rules) {
      const inReducedMotion = rule.media !== undefined && REDUCED_MOTION.test(rule.media);
      const transition = rule.declarations.get('transition') ?? rule.declarations.get('transition-duration');
      if (!inReducedMotion && transition !== undefined && LITERAL_DURATION.test(withoutTokens(transition))) {
        report('transition', transition, `${rule.selectors.join(', ')}: transition: ${transition} (take the duration from a --cd-dur-* token, which is 0 under reduced motion)`);
      }
      const animation = rule.declarations.get('animation') ?? rule.declarations.get('animation-duration');
      if (!inReducedMotion && animation !== undefined && animation !== 'none' && (LITERAL_DURATION.test(withoutTokens(animation)) || /\binfinite\b/.test(animation))) {
        for (const selector of rule.selectors.filter((selector) => !switchedOff.has(normal(selector)))) {
          report('animation', animation, `${selector}: animation: ${animation} loops or has a literal duration, so switch it off under reduced motion: @media (prefers-reduced-motion: reduce) { ${selector} { animation: none !important; } }`);
        }
      }
      const scroll = rule.declarations.get('scroll-behavior');
      if (scroll !== undefined && /smooth/.test(scroll) && !(rule.media !== undefined && /prefers-reduced-motion:\s*no-preference/.test(rule.media))) {
        report('scroll-behavior', scroll, `${rule.selectors.join(', ')}: scroll-behavior: ${scroll} (smooth scrolling only under @media (prefers-reduced-motion: no-preference))`);
      }
    }
  }
  return findings;
}

/** The ESTree nodes oxc produces, with the fields this lint reads; each `is…` guard checks the `type` before the fields are used. */
interface Node {
  type: string;
  start: number;
}
interface StringLiteral extends Node {
  type: 'Literal';
  value: unknown;
}
interface TemplateLiteral extends Node {
  type: 'TemplateLiteral';
  quasis: { value: { cooked: string } }[];
}
interface JsxText extends Node {
  type: 'JSXText';
  value: string;
}
interface JsxExpressionContainer extends Node {
  type: 'JSXExpressionContainer';
  expression: Node;
}
interface JsxAttribute extends Node {
  type: 'JSXAttribute';
  name: { name: string };
  value: Node | null;
}
interface JsxElement extends Node {
  type: 'JSXElement';
  openingElement: { name: { name?: string }; attributes: Node[] };
  children: Node[];
}
interface Property extends Node {
  type: 'Property';
  key: { name?: string; value?: unknown };
  value: Node;
}

const isNode = (value: unknown): value is Node => typeof value === 'object' && value !== null && 'type' in value && typeof value.type === 'string';
const isLiteral = (node: Node): node is StringLiteral => node.type === 'Literal';
const isTemplate = (node: Node): node is TemplateLiteral => node.type === 'TemplateLiteral';
const isJsxText = (node: Node): node is JsxText => node.type === 'JSXText';
const isExpressionContainer = (node: Node): node is JsxExpressionContainer => node.type === 'JSXExpressionContainer';
const isJsxAttribute = (node: Node): node is JsxAttribute => node.type === 'JSXAttribute';
const isJsxElement = (node: Node): node is JsxElement => node.type === 'JSXElement';
const isProperty = (node: Node): node is Property => node.type === 'Property';

function walk(node: Node, visit: (node: Node, parent: Node | undefined) => void, parent?: Node): void {
  visit(node, parent);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.filter(isNode).forEach((child) => walk(child, visit, node));
    else if (isNode(value)) walk(value, visit, node);
  }
}

/** The text of a string literal or a template literal without substitutions' values. */
function stringValue(node: Node | null | undefined): string | undefined {
  if (!node) return undefined;
  if (isLiteral(node)) return typeof node.value === 'string' ? node.value : undefined;
  return isTemplate(node) ? node.quasis.map((quasi) => quasi.value.cooked).join('') : undefined;
}

/** An attribute's value: `x="…"` or `x={…}`. */
const attributeValue = (attribute: JsxAttribute | undefined): Node | null | undefined => (attribute?.value && isExpressionContainer(attribute.value) ? attribute.value.expression : attribute?.value);

const tagName = (element: JsxElement): string => element.openingElement.name.name ?? '';
const attributeOf = (element: JsxElement, name: string): JsxAttribute | undefined => element.openingElement.attributes.filter(isJsxAttribute).find((a) => a.name.name === name);

/** Whether a JSX element shows any text (or may: an expression could render text), apart from icons. */
function showsText(element: JsxElement): boolean {
  return element.children.some((child) => {
    if (isJsxText(child)) return child.value.trim() !== '';
    if (isExpressionContainer(child)) return child.expression.type !== 'JSXEmptyExpression';
    if (!isJsxElement(child)) return false;
    return tagName(child) !== 'Icon' && tagName(child) !== 'svg' && (showsText(child) || attributeOf(child, 'aria-label') !== undefined);
  });
}

/** JSX attributes whose strings are ids, links or references (`href="#add"` is an anchor, not a colour). */
const REFERENCE_ATTRIBUTE = /^(href|id|to|htmlFor|form|list|aria-controls|aria-labelledby|aria-describedby)$/;

const COLOUR_PROPERTY = /colou?r|background|fill|stroke|border|outline|shadow/i;
const COLOUR_ATTRIBUTE = /^(fill|stroke|color|stopColor|floodColor|lightingColor)$/;

function lintTypeScript(file: string, source: string): Finding[] {
  const findings: Finding[] = [];
  const add = (node: Node, rule: Finding['rule'], message: string) => findings.push({ file, line: lineOf(source, node.start), rule, message });
  const ast = parseAst(source, { lang: file.endsWith('.tsx') ? 'tsx' : 'ts' }, file);
  walk(ast as unknown as Node, (node, parent) => {
    const text = isLiteral(node) || isTemplate(node) ? stringValue(node) : undefined;
    const isReference = parent !== undefined && isJsxAttribute(parent) && REFERENCE_ATTRIBUTE.test(parent.name.name);
    if (text !== undefined) {
      if (!isReference && (/^\s*#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})\s*$/i.test(text) || COLOUR_FUNCTION.test(text))) add(node, 'raw-colour', `"${text}" (use a --cd-* colour token)`);
      if (VH_UNIT.test(text)) add(node, 'vh', `"${text}" (use dvh, svh or lvh)`);
    }
    // A named colour given to a colour attribute (`fill="red"`) or style property (`{ color: 'red' }`).
    if (isJsxAttribute(node) && COLOUR_ATTRIBUTE.test(node.name.name)) {
      const named = stringValue(attributeValue(node))?.trim().toLowerCase();
      if (named && NAMED_COLOURS.has(named)) add(node, 'raw-colour', `${node.name.name}="${named}" (use a --cd-* colour token)`);
    }
    if (isProperty(node)) {
      const key = String(node.key.name ?? node.key.value);
      const named = COLOUR_PROPERTY.test(key) ? stringValue(node.value)?.trim().toLowerCase() : undefined;
      if (named && NAMED_COLOURS.has(named)) add(node, 'raw-colour', `${key}: '${named}' (use a --cd-* colour token)`);
      // `scrollTo({ behavior: 'smooth' })` ignores the reduced-motion setting; choose the behaviour from `matchMedia('(prefers-reduced-motion: reduce)')`.
      if (key === 'behavior' && stringValue(node.value) === 'smooth') add(node, 'motion', `behavior: 'smooth' (pick 'auto' when (prefers-reduced-motion: reduce) matches)`);
    }
    // Icon buttons: a <button>, or any element styled `btn--icon`, must be named.
    if (isJsxElement(node)) {
      const classNames = stringValue(attributeValue(attributeOf(node, 'className'))) ?? '';
      const needsName = tagName(node) === 'button' || /\bbtn--icon\b/.test(classNames);
      const named = attributeOf(node, 'aria-label') !== undefined || attributeOf(node, 'aria-labelledby') !== undefined;
      if (needsName && !named && !showsText(node)) add(node, 'icon-button', `<${tagName(node)}> shows only an icon: give it an aria-label`);
    }
  });
  return findings;
}

function lintHtml(file: string, html: string): Finding[] {
  const findings: Finding[] = [];
  for (const meta of html.matchAll(/<meta[^>]*name=["']viewport["'][^>]*>/gi)) {
    if (/user-scalable\s*=\s*(no|0)|maximum-scale/i.test(meta[0])) findings.push({ file, line: lineOf(html, meta.index), rule: 'zoom-lock', message: 'the viewport meta must not lock zoom (no user-scalable=no, no maximum-scale)' });
  }
  return findings;
}

/** Every file below `dir` with one of `extensions`. */
function filesBelow(dir: string, extensions: string[]): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' || entry.name === 'dist' ? [] : filesBelow(full, extensions);
    return extensions.includes(path.extname(entry.name)) ? [full] : [];
  });
}

const findings: Finding[] = [];
const stylesheets: { file: string; css: string }[] = [];
for (const file of filesBelow(path.join(WEB, 'src'), ['.css', '.ts', '.tsx'])) {
  const source = fs.readFileSync(file, 'utf8');
  const relative = path.relative(path.dirname(WEB), file);
  if (file.endsWith('.css')) stylesheets.push({ file: relative, css: source });
  findings.push(...(file.endsWith('.css') ? lintCss(relative, source) : lintTypeScript(relative, source)));
}
findings.push(...lintMotion(stylesheets));
findings.push(...lintHtml('web/index.html', fs.readFileSync(path.join(WEB, 'index.html'), 'utf8')));

for (const { file, line, rule, message } of findings) console.error(`${file}:${line}  ${rule}  ${message}`);
if (findings.length > 0) {
  console.error(`\nlint:ui found ${findings.length} problem${findings.length === 1 ? '' : 's'}.`);
  process.exit(1);
}
console.log('lint:ui: no raw colours, no vh, every icon button named, zoom not locked, reduced motion respected.');
