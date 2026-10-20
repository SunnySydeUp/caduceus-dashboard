// What the owner can do with words selected in one of Hermes's replies (M1 #09): quote them into the composer (Reply with selection), or ask Hermes to
// refine them with a chip (shorter, simpler, more detail…), which sends a follow-up that quotes the selection. No DOM and no React.

/** The most characters of a selection that go into a quote or a follow-up; more is cut, and says so. */
export const MAX_SELECTION = 4000;

/** The selected words, trimmed, cut at `MAX_SELECTION`; undefined when nothing but whitespace is selected. */
export function selectedText(raw: string): string | undefined {
  const text = raw.trim();
  if (text === '') return undefined;
  return text.length > MAX_SELECTION ? `${text.slice(0, MAX_SELECTION)}…` : text;
}

/** The selection as a block quote, each line marked, with a blank line after it for the owner's own words. */
export function quoteSelection(text: string): string {
  return `${text
    .split('\n')
    .map((line) => (line === '' ? '>' : `> ${line}`))
    .join('\n')}\n\n`;
}

/** The composer's text after Reply with selection: the quote after what is there, kept apart from it by a blank line. */
export function replyWithSelection(draft: string, selection: string): string {
  const quote = quoteSelection(selection);
  const before = draft.trimEnd();
  return before === '' ? quote : `${before}\n\n${quote}`;
}

export interface Refinement {
  id: 'shorter' | 'simpler' | 'detail' | 'example' | 'why';
  /** The chip's words. */
  label: string;
  /** What is asked, before the quote. */
  ask: string;
}

export const REFINEMENTS: readonly Refinement[] = [
  { id: 'shorter', label: 'Shorter', ask: 'Make this shorter' },
  { id: 'simpler', label: 'Simpler', ask: 'Say this more simply' },
  { id: 'detail', label: 'More detail', ask: 'Give more detail on this' },
  { id: 'example', label: 'Give an example', ask: 'Give an example of this' },
  { id: 'why', label: 'Explain why', ask: 'Explain why this is so' },
];

/** The follow-up a chip sends: the ask, then the selection quoted. */
export function refinePrompt(chip: Refinement, selection: string): string {
  return `${chip.ask}:\n\n${quoteSelection(selection).trimEnd()}`;
}
