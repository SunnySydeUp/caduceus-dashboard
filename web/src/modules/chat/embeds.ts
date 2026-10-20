// What a reply may embed (M1 #04), and under which restrictions: pure, so that the rules are checked without a browser.

/**
 * The `sandbox` attribute of an HTML preview frame: empty, which is every restriction there is. No `allow-scripts`, so nothing
 * in the reply's HTML runs; no `allow-same-origin`, so it is not Caduceus's origin even if it could; no forms, popups or navigation.
 */
export const HTML_SANDBOX = '';

/**
 * The document an HTML preview frame shows (its `srcdoc`). The policy comes first and the reply's HTML after it, so a `</head>`
 * in the reply cannot displace it. It allows inline styles and images that are data or https, and nothing else: no script, no
 * connection, no frame, no form. (The sandbox already stops scripts; the policy is the second wall.)
 */
export function htmlPreviewDocument(html: string): string {
  const policy = "default-src 'none'; img-src data: https:; media-src data: https:; font-src data:; style-src 'unsafe-inline'";
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="viewport" content="width=device-width, initial-scale=1"><style>:root{color-scheme:light dark}body{margin:8px;font:14px/1.5 system-ui,sans-serif;overflow-wrap:anywhere}img,video{max-width:100%}</style>${html}`;
}

/**
 * Mermaid's settings. `strict` makes the engine encode the diagram text and sanitise labels, and it turns click handlers off;
 * HTML labels are off because the result is shown as an image, where a foreign object is not drawn consistently.
 */
export const MERMAID_CONFIG = { startOnLoad: false, securityLevel: 'strict', flowchart: { htmlLabels: false }, theme: 'neutral' } as const;

/**
 * The `src` for an `<img>` showing an SVG the diagram engine drew. An image never runs script and loads nothing of its own, which
 * is the guarantee; script elements, event handler attributes and `javascript:` targets are taken out as well, since nothing
 * should depend on one wall.
 */
export function svgImageSource(svg: string): string {
  const clean = svg
    .replace(/<script[\s\S]*?<\/script\s*>/gi, '')
    .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href\s*=\s*["']?)\s*javascript:[^"'>\s]*/gi, '$1#');
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(clean)}`;
}
