// Where dictated words go in the message box (M7 #07), free of the DOM and of React: at the caret (over a selection), spaced as words in a sentence.

/** `spoken` put into `text` at the selection: a space is added on a side that touches another word. The caret ends after the words. */
export function dictate(text: string, selection: { start: number; end: number }, spoken: string): { text: string; caret: number } {
  const words = spoken.trim();
  const before = text.slice(0, selection.start);
  const after = text.slice(selection.end);
  const lead = before === '' || /\s$/.test(before) ? '' : ' ';
  const tail = after === '' || /^\s/.test(after) ? '' : ' ';
  const inserted = `${lead}${words}${tail}`;
  return { text: before + inserted + after, caret: before.length + lead.length + words.length + tail.length };
}
