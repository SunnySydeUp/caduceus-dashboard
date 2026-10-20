// The heavy renderers (M1 #04): syntax highlighting, maths and diagrams. Each library is imported on first use, so none of them is
// in the first load; a reply with no code, no formula and no diagram never fetches them. Output is markup strings built by the
// libraries from escaped text, or an `<img>` source (Mermaid): never the reply's own markup.
import { MERMAID_CONFIG, svgImageSource } from './embeds.ts';

let highlighter: Promise<typeof import('./highlight-languages.ts')> | undefined;

/** The highlighted HTML of `text` in `lang`, or undefined when the language is not one we know (the code stands as plain text). */
export async function highlightCode(lang: string, text: string): Promise<string | undefined> {
  highlighter ??= import('./highlight-languages.ts');
  const { default: hljs } = await highlighter;
  const language = hljs.getLanguage(lang.toLowerCase()) ? lang.toLowerCase() : undefined;
  return language === undefined ? undefined : hljs.highlight(text, { language, ignoreIllegals: true }).value;
}

/** KaTeX markup for `tex`, or undefined when KaTeX will not take it (a formula still being typed, a command it does not trust). */
export async function renderMath(tex: string, display: boolean): Promise<string | undefined> {
  const [{ default: katex }] = await Promise.all([import('katex'), import('katex/dist/katex.min.css')]);
  try {
    return katex.renderToString(tex, { displayMode: display, throwOnError: true, trust: false, strict: 'ignore', maxSize: 30, maxExpand: 1000 });
  } catch {
    return undefined;
  }
}

let diagrams = 0;
let mermaidReady: Promise<(typeof import('mermaid'))['default']> | undefined;

/** A diagram as an image source, or the engine's complaint (a diagram still being typed is mostly that). */
export async function renderMermaid(source: string): Promise<{ ok: true; src: string; width: number; height: number } | { ok: false; error: string }> {
  mermaidReady ??= import('mermaid').then(({ default: mermaid }) => {
    mermaid.initialize(MERMAID_CONFIG);
    return mermaid;
  });
  const mermaid = await mermaidReady;
  try {
    await mermaid.parse(source);
    const { svg } = await mermaid.render(`cd-diagram-${diagrams++}`, source);
    // The drawing's own size, from its viewBox: an SVG that says only `width="100%"` has no size as an image, and the image would be drawn at nothing.
    const box = /viewBox="[-\d.]+ [-\d.]+ ([\d.]+) ([\d.]+)"/.exec(svg);
    return { ok: true, src: svgImageSource(svg), width: Math.ceil(Number(box?.[1] ?? 300)), height: Math.ceil(Number(box?.[2] ?? 150)) };
  } catch (error) {
    document.getElementById(`dcd-diagram-${diagrams - 1}`)?.remove();
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
