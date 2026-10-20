// The conversation outline (M1 #04): the owner's prompts and the headings of the replies, in order, for the desktop's outline pane.
// Pure. Headings come from the same parse the transcript renders, so what the outline lists is what the reader sees.
import { inlineText, parseMarkdown } from './markdown.ts';

export interface OutlineSource {
  key: string;
  role: 'user' | 'assistant';
  text: string;
}

export interface OutlineEntry {
  kind: 'prompt' | 'heading';
  /** The message to scroll to. */
  key: string;
  /** 0 for a prompt, the heading level (1–3) for a heading. */
  level: number;
  label: string;
  /** The heading's slug within its message; the screen scrolls to it once the message is on screen. */
  anchor: string | undefined;
}

const PROMPT_LABEL_CHARS = 80;
const MAX_LEVEL = 3;
/** Replies parsed so far, by text: a streaming reply is parsed again for each chunk, the rest are not. */
const CACHE_LIMIT = 400;

/** Makes an outline builder that remembers what it has parsed. */
export function createOutlineBuilder() {
  const headings = new Map<string, { level: number; label: string; anchor: string }[]>();
  const headingsOf = (text: string) => {
    let found = headings.get(text);
    if (!found) {
      found = parseMarkdown(text).blocks.flatMap((block) => (block.t === 'heading' && block.level <= MAX_LEVEL ? [{ level: block.level, label: inlineText(block.children), anchor: block.id }] : []));
      if (headings.size >= CACHE_LIMIT) headings.clear();
      headings.set(text, found);
    }
    return found;
  };
  return (messages: readonly OutlineSource[]): OutlineEntry[] =>
    messages.flatMap((message): OutlineEntry[] => {
      if (message.role === 'assistant') return headingsOf(message.text).map((heading) => ({ kind: 'heading', key: message.key, ...heading }));
      const line = message.text.replace(/\s+/g, ' ').trim();
      if (line === '') return [];
      const label = line.length > PROMPT_LABEL_CHARS ? `${line.slice(0, PROMPT_LABEL_CHARS - 1)}…` : line;
      return [{ kind: 'prompt', key: message.key, level: 0, label, anchor: undefined }];
    });
}
