// Exporting a session (M1 #17): Hermes's `GET /api/sessions/{id}/export` (a session row with its messages, as JSON) becomes a Markdown, JSON or
// themed HTML file in the browser. No DOM and no React, so the builders run under test; Hermes holds the conversation and Caduceus keeps no copy.

import { isRecord } from '@caduceus/contracts/policy/guards';

export type ExportFormat = 'markdown' | 'json' | 'html';

export const EXPORT_FORMATS: readonly { value: ExportFormat; label: string; sub: string }[] = [
  { value: 'markdown', label: 'Markdown', sub: 'Plain text that any notes app opens' },
  { value: 'html', label: 'Web page', sub: 'One file in the colours you use now, with nothing to load' },
  { value: 'json', label: 'JSON', sub: 'Everything Hermes keeps, so that it can be imported again' },
];

/** The theme tokens the HTML page is drawn with. The page reads their resolved values from the app, so the file looks as the app does now. */
export const EXPORT_TOKENS = [
  '--cd-bg-canvas',
  '--cd-bg-surface',
  '--cd-bg-inset',
  '--cd-fg-default',
  '--cd-fg-muted',
  '--cd-border-default',
  '--cd-accent',
  '--cd-accent-soft',
  '--cd-font-sans',
  '--cd-font-mono',
  '--cd-radius-md',
] as const;

export interface ExportMessage {
  role: string;
  /** The words of the message: a string as it is, or the text parts of a list of parts. */
  text: string;
  reasoning: string | undefined;
  toolCalls: { name: string; arguments: string }[];
  toolName: string | undefined;
}

export interface ExportedSession {
  id: string;
  title: string;
  source: string;
  model: string;
  cwd: string;
  /** Seconds since the epoch. */
  startedAt: number | undefined;
  /** The messages a reader sees: not the ones a rewind took out of the conversation. */
  messages: ExportMessage[];
  /** Hermes's export exactly as it answered, for the JSON file. */
  record: Record<string, unknown>;
}

export interface ExportFile {
  filename: string;
  mime: string;
  content: string;
}

const str = (value: unknown): string => (typeof value === 'string' ? value : '');

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((part) => (isRecord(part) && part.type === 'text' ? str(part.text) : '')).filter((part) => part !== '').join('\n');
  return content === null || content === undefined ? '' : JSON.stringify(content);
}

function toolCallsOf(value: unknown): ExportMessage['toolCalls'] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((call) => {
    const fn = isRecord(call.function) ? call.function : {};
    const args = fn.arguments;
    return { name: str(fn.name) || 'tool', arguments: typeof args === 'string' ? args : JSON.stringify(args ?? {}) };
  });
}

/** Hermes's export as a session. Throws, in plain words, when the answer is not one. */
export function readExport(body: unknown): ExportedSession {
  if (!isRecord(body)) throw new Error('Hermes’s export is not a session');
  if (!Array.isArray(body.messages)) throw new Error('Hermes’s export has no messages list');
  // Hermes shows a message that is active or compacted; a rewind makes the ones it took back inactive.
  const visible = body.messages.filter(isRecord).filter((message) => message.active === undefined || message.active === 1 || message.compacted === 1);
  return {
    id: str(body.id),
    title: str(body.title),
    source: str(body.source),
    model: str(body.model),
    cwd: str(body.cwd),
    startedAt: typeof body.started_at === 'number' ? body.started_at : undefined,
    messages: visible.map((message) => ({
      role: str(message.role),
      text: textOf(message.content),
      reasoning: str(message.reasoning) || undefined,
      toolCalls: toolCallsOf(message.tool_calls),
      toolName: str(message.tool_name) || undefined,
    })),
    record: body,
  };
}

const slug = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');

const EXTENSIONS: Record<ExportFormat, string> = { markdown: 'md', json: 'json', html: 'html' };

/** A safe file name: the title as a slug and the end of the id (which tells two sessions of one title apart), or `session-` and the id. */
export function exportFilename(session: ExportedSession, format: ExportFormat): string {
  const tail = slug(session.id.slice(-12)) || 'chat';
  const title = slug(session.title);
  return `${title ? `${title}-` : 'session-'}${tail}.${EXTENSIONS[format]}`;
}

const heading = (session: ExportedSession): string => session.title || 'Untitled chat';
const isoSeconds = (seconds: number): string => new Date(seconds * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
const ROLES: Record<string, string> = { user: 'You', assistant: 'Hermes', system: 'System' };

/** The facts a file opens with, as label and value. */
function factsOf(session: ExportedSession): [string, string][] {
  const facts: [string, string | undefined][] = [
    ['Session', session.id],
    ['Source', session.source],
    ['Model', session.model],
    ['Folder', session.cwd],
    ['Started', session.startedAt === undefined ? undefined : isoSeconds(session.startedAt)],
    ['Messages', String(session.messages.length)],
  ];
  return facts.filter((fact): fact is [string, string] => fact[1] !== undefined && fact[1] !== '');
}

/** A fence one backtick longer than the longest run inside the text. */
function fenced(text: string, info = ''): string {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((run) => run[0].length));
  const fence = '`'.repeat(longest + 1);
  return `${fence}${info}\n${text}\n${fence}`;
}

function markdownOf(session: ExportedSession): string {
  const out = [`# ${heading(session)}`, factsOf(session).map(([label, value]) => `- ${label}: ${value}`).join('\n'), '---'];
  for (const message of session.messages) {
    if (message.role === 'tool') {
      out.push(`**Tool result: ${message.toolName ?? 'tool'}**\n\n${fenced(message.text)}`);
      continue;
    }
    out.push(`## ${ROLES[message.role] ?? message.role}`);
    if (message.reasoning) out.push(`<details><summary>Reasoning</summary>\n\n${message.reasoning}\n\n</details>`);
    if (message.text) out.push(message.text);
    for (const call of message.toolCalls) out.push(`**Tool call: ${call.name}**\n\n${fenced(call.arguments, 'json')}`);
  }
  return `${out.join('\n\n')}\n`;
}

const escapeHtml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** The message text as paragraphs and code blocks (a fenced block of the Markdown the model wrote), every character escaped. */
function htmlBody(text: string): string {
  const out: string[] = [];
  let prose: string[] = [];
  let code: string[] | undefined;
  let fence = '';
  const flush = () => {
    const joined = prose.join('\n').trim();
    if (joined) out.push(`<p class="text">${escapeHtml(joined)}</p>`);
    prose = [];
  };
  for (const line of text.split('\n')) {
    if (code === undefined) {
      const open = /^(`{3,})[^`]*$/.exec(line);
      if (open) {
        flush();
        code = [];
        fence = open[1]!;
      } else prose.push(line);
    } else if (line.trim().startsWith(fence) && /^`+$/.test(line.trim())) {
      out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
      code = undefined;
    } else code.push(line);
  }
  if (code !== undefined) out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
  flush();
  return out.join('\n');
}

const PAGE_STYLE = `
*{box-sizing:border-box}
body{margin:0;background:var(--cd-bg-canvas);color:var(--cd-fg-default);font-family:var(--cd-font-sans);line-height:1.55}
main{max-inline-size:48rem;margin-inline:auto;padding:1.5rem 1rem 3rem}
h1{font-size:1.5rem;margin:0 0 .75rem}
h2{font-size:.8125rem;margin:0 0 .5rem;color:var(--cd-fg-muted);text-transform:uppercase;letter-spacing:.04em}
dl{display:grid;grid-template-columns:max-content 1fr;gap:.125rem 1rem;margin:0 0 1.5rem;color:var(--cd-fg-muted);font-size:.875rem}
dt{font-weight:600}
dd{margin:0;overflow-wrap:anywhere}
article{background:var(--cd-bg-surface);border:1px solid var(--cd-border-default);border-radius:var(--cd-radius-md);padding:.75rem 1rem;margin-block:.75rem}
article.user{background:var(--cd-accent-soft);border-color:var(--cd-accent)}
article.tool{background:var(--cd-bg-inset)}
.text{margin:0 0 .5rem;white-space:pre-wrap;overflow-wrap:anywhere}
pre{margin:0 0 .5rem;padding:.5rem .75rem;background:var(--cd-bg-inset);border:1px solid var(--cd-border-default);border-radius:var(--cd-radius-md);overflow-x:auto}
code{font-family:var(--cd-font-mono);font-size:.875em}
details{margin:0 0 .5rem;color:var(--cd-fg-muted)}
summary{cursor:pointer}
.label{margin:0 0 .25rem;font-weight:600;font-size:.875rem}
`.trim();

function htmlOf(session: ExportedSession, tokens: Readonly<Record<string, string>>): string {
  const declarations = EXPORT_TOKENS.flatMap((name) => {
    const value = (tokens[name] ?? '').replace(/[<>{};]/g, '').trim();
    return value === '' ? [] : [`${name}:${value};`];
  });
  const articles = session.messages.map((message) => {
    if (message.role === 'tool') return `<article class="tool"><p class="label">Tool result: ${escapeHtml(message.toolName ?? 'tool')}</p><pre><code>${escapeHtml(message.text)}</code></pre></article>`;
    const parts = [`<h2>${escapeHtml(ROLES[message.role] ?? message.role)}</h2>`];
    if (message.reasoning) parts.push(`<details><summary>Reasoning</summary><p class="text">${escapeHtml(message.reasoning)}</p></details>`);
    if (message.text) parts.push(htmlBody(message.text));
    for (const call of message.toolCalls) parts.push(`<p class="label">Tool call: ${escapeHtml(call.name)}</p><pre><code>${escapeHtml(call.arguments)}</code></pre>`);
    return `<article class="${escapeHtml(message.role)}">\n${parts.join('\n')}\n</article>`;
  });
  const facts = factsOf(session).map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>${escapeHtml(heading(session))}</title>
<style>
:root{${declarations.join('')}}
${PAGE_STYLE}
</style>
</head>
<body>
<main>
<h1>${escapeHtml(heading(session))}</h1>
<dl>${facts.join('')}</dl>
${articles.join('\n')}
</main>
</body>
</html>
`;
}

/** The file for one format. `tokens` are the theme's resolved values (`EXPORT_TOKENS`), read from the page; only the HTML uses them. */
export function exportFile(session: ExportedSession, format: ExportFormat, { tokens }: { tokens: Readonly<Record<string, string>> }): ExportFile {
  const filename = exportFilename(session, format);
  if (format === 'json') return { filename, mime: 'application/json', content: `${JSON.stringify(session.record, null, 2)}\n` };
  if (format === 'markdown') return { filename, mime: 'text/markdown', content: markdownOf(session) };
  return { filename, mime: 'text/html', content: htmlOf(session, tokens) };
}
