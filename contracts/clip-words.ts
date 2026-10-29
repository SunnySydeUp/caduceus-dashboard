/**
 * `text` cut to at most `max` characters for a screen. It is cut at the last whole word, never in the middle of one (a lone word longer than `max` has no break
 * to use and is cut), and an ellipsis says that it was cut. Words that fit are returned as they are.
 */
export function clipWords(text: string, max: number): string {
  if (text.length <= max) return text;
  const room = text.slice(0, max - 1);
  // The cut falls between two words when the next character is a space; otherwise it falls inside one, and the room is taken back to the last space.
  const breaksCleanly = /\s/.test(text.charAt(max - 1));
  const lastSpace = room.search(/\s\S*$/);
  const whole = breaksCleanly || lastSpace <= 0 ? room : room.slice(0, lastSpace);
  return `${whole.replace(/[\s,;:.\-–—]+$/, '')}…`;
}
