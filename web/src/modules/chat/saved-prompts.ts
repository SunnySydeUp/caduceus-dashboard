// The saved-prompts library's logic (M1 #11), free of the DOM and of React: finding a prompt, the tags to filter by, and putting one into the message box.
import type { SavedPrompt } from '@caduceus/contracts/chat-drafts';

/** The prompts that match every word of `query` in their name, text or tags, and carry `tag` when one is chosen; the order is kept. */
export function filterPrompts(prompts: readonly SavedPrompt[], { query, tag }: { query: string; tag?: string | undefined }): SavedPrompt[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return prompts.filter((prompt) => {
    if (tag !== undefined && !prompt.tags.includes(tag)) return false;
    const haystack = `${prompt.name}\n${prompt.text}\n${prompt.tags.join(' ')}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

/** The tags in use and how many prompts carry each, the most used first, then alphabetical. */
export function tagsOf(prompts: readonly SavedPrompt[]): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const prompt of prompts) for (const tag of prompt.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/** Tags typed as a line, split at commas: trimmed, lower-cased, each kept once. */
export function parseTags(line: string): string[] {
  return [...new Set(line.split(',').map((tag) => tag.replace(/\s+/g, ' ').trim().toLowerCase()).filter(Boolean))];
}

/** `insert` put into `text` where the selection is (a selection is replaced); the caret ends after it. */
export function insertAtCaret(text: string, selection: { start: number; end: number }, insert: string): { text: string; caret: number } {
  return { text: text.slice(0, selection.start) + insert + text.slice(selection.end), caret: selection.start + insert.length };
}

/** The prompts a profile shows: those for every profile and those for this one. The server never lists one scoped to another for a profile, and the page keeps the whole list, so it narrows it here. */
export function forProfile(prompts: readonly SavedPrompt[], profile: string): SavedPrompt[] {
  return prompts.filter((prompt) => prompt.profile === null || prompt.profile === profile);
}
