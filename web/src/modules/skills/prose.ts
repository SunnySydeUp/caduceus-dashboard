// Markdown that was wrapped by hand (a SKILL.md, a catalogue note) reads as one paragraph, not as lines that end where somebody's editor
// did. Caduceus draws a newline inside a paragraph as a line break because that is what a chat message means by it; text that was
// wrapped at 72 columns means the opposite, so its paragraphs are joined before they are drawn. Pure: no DOM, no React.

/** The start of a block that is not a plain continuation line: a heading, a list item, a quote, a table row, a fence, a rule, a tag or code. */
const BLOCK_START = /^(\s*([-*+]|\d+[.)])\s|\s*#{1,6}(\s|$)|\s*>|\s*\||\s*(```|~~~)|\s*([-*_])(\s*\5){2,}\s*$|\s*<|\t| {4})/;

/**
 * Joins the lines of each paragraph with a space. Blank lines, fenced code, headings, quotes, tables, rules, tags and indented code stay as
 * they are; so does a line the writer ended with a backslash or two spaces (a hard break), and a line that continues a list item is joined to it.
 */
export function wrapProse(markdown: string): string {
  const out: string[] = [];
  let fence: string | undefined;
  let joinable = false;
  for (const line of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    const marker = /^\s*(```|~~~)/.exec(line)?.[1];
    if (fence) {
      out.push(line);
      if (marker === fence) fence = undefined;
      joinable = false;
      continue;
    }
    if (marker) {
      fence = marker;
      out.push(line);
      joinable = false;
      continue;
    }
    if (line.trim() === '') {
      out.push(line);
      joinable = false;
      continue;
    }
    const startsBlock = BLOCK_START.test(line);
    if (joinable && !startsBlock) {
      out[out.length - 1] += ` ${line.trim()}`;
    } else {
      out.push(line);
    }
    // A heading, a table row, a rule or a tag line never takes the next line; a paragraph or list item does, unless a hard break ends it.
    joinable = !/^\s*(#{1,6}(\s|$)|\||>|<)/.test(line) && !/^\s*([-*_])(\s*\1){2,}\s*$/.test(line) && !/( {2}|\\)$/.test(line);
  }
  return out.join('\n');
}
