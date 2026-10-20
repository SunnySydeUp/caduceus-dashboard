// What is spoken of a reply (M7 #07): the words, not the markup. Hermes strips some Markdown itself, but a code block read out letter by letter,
// a table read cell by cell or a URL spelled out is no help to a listener, so the page cleans the text first. Free of the DOM and of React.

/** Hermes's text to speech takes a bounded text (OpenAI's takes 4096 characters); a reply longer than this goes in several parts. */
export const SPEECH_PART_CHARS = 3000;

const sentence = (line: string) => (/[.!?…:;]$/.test(line) ? line : `${line}.`);

/** The reply as plain sentences. */
export function speakable(markdown: string): string {
  const lines: string[] = [];
  let fenced = false;
  let table = false;
  for (const raw of markdown.split('\n')) {
    if (/^\s*(```|~~~)/.test(raw)) {
      if (!fenced) lines.push('Code block omitted.');
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    if (/^\s*\|/.test(raw)) {
      if (!table) lines.push('Table omitted.');
      table = true;
      continue;
    }
    table = false;
    let line = raw
      .replace(/^\s{0,3}#{1,6}\s+/, '')
      .replace(/^\s*>+\s?/, '')
      .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/https?:\/\/\S+/g, 'link')
      .replace(/(\*\*|__)(.*?)\1/g, '$2')
      .replace(/(\*|_)(.*?)\1/g, '$2')
      .replace(/~~(.*?)~~/g, '$1')
      .replace(/`([^`]*)`/g, '$1')
      .trim();
    if (/^[-*_]{3,}$/.test(line)) line = '';
    if (line === '') continue;
    // Headings, list items and quotes are spoken as sentences of their own; a paragraph's lines read on.
    const isBlock = /^\s{0,3}(#{1,6}\s|>|[-*+]\s|\d+[.)]\s)/.test(raw);
    lines.push(isBlock ? sentence(line) : line);
  }
  return lines.join(' ').replace(/\s+/g, ' ').trim();
}

/** The text in parts of at most `limit` characters, each cut at the end of a sentence where there is one. */
export function speechParts(text: string, limit = SPEECH_PART_CHARS): string[] {
  const parts: string[] = [];
  let rest = text.trim();
  while (rest.length > limit) {
    const window = rest.slice(0, limit);
    const cut = Math.max(window.lastIndexOf('. '), window.lastIndexOf('! '), window.lastIndexOf('? '));
    const at = cut > limit / 4 ? cut + 1 : window.lastIndexOf(' ') > 0 ? window.lastIndexOf(' ') : limit;
    parts.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest !== '') parts.push(rest);
  return parts;
}
