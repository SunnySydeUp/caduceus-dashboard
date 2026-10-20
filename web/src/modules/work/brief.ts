// The Brief's sections as Markdown (work model §2.1). A Brief is the guided task editor; what it writes into the task's `body` is plain
// Markdown headings that Hermes workers read as they are. No DOM and no React, and nothing is kept: the body in Hermes is the Brief.

export const BRIEF_SECTIONS = [
  { id: 'goal', heading: 'Goal', help: 'What done looks like, in a sentence or two.' },
  { id: 'context', heading: 'Context', help: 'What the worker needs to know first: background, decisions already made.' },
  { id: 'references', heading: 'References', help: 'Links, files and earlier work to read. Files can also be attached.' },
  { id: 'constraints', heading: 'Constraints', help: 'What must not change, limits, style rules.' },
  { id: 'expected', heading: 'Expected output', help: 'What the worker hands back: a pull request, a report, a file.' },
  { id: 'scope', heading: 'Scope and safety', help: 'What the worker may touch, and what it must ask about first.' },
] as const;

export type SectionId = (typeof BRIEF_SECTIONS)[number]['id'];

/** The text of each section; an empty one is left out of the body. */
export type BriefSections = Record<SectionId, string>;

/** A body as the editor holds it: the six sections, or (when the body is not made of them) one free section that is the body itself. */
export type BriefText = { kind: 'sections'; sections: BriefSections } | { kind: 'free'; text: string };

export function emptySections(): BriefSections {
  return { goal: '', context: '', references: '', constraints: '', expected: '', scope: '' };
}

/** The Markdown a worker reads: every filled section under its heading, in the Brief's order. The free section is the body exactly as typed. */
export function serialiseBrief(brief: BriefText): string {
  if (brief.kind === 'free') return brief.text;
  const parts = BRIEF_SECTIONS.flatMap(({ id, heading }) => {
    const text = brief.sections[id].trim();
    return text === '' ? [] : [`## ${heading}\n\n${text}`];
  });
  return parts.length === 0 ? '' : `${parts.join('\n\n')}\n`;
}

const HEADING = /^##[ \t]+(.*?)[ \t]*(?:#+[ \t]*)?$/;
const FENCE = /^[ \t]{0,3}(`{3,}|~{3,})/;
const normalise = (name: string) => name.toLowerCase().replace(/\s+/g, ' ').trim();
const KNOWN = new Map<string, SectionId>(BRIEF_SECTIONS.map(({ id, heading }) => [normalise(heading), id]));

/**
 * Reads a task body into sections where its `##` headings are the Brief's. A body that is anything else (text before the first
 * heading, a heading the Brief does not know, a heading twice, no heading at all: what the CLI, a worker or Specify wrote) is one free
 * section, so editing it loses nothing.
 */
export function parseBrief(body: string | null | undefined): BriefText {
  const text = body ?? '';
  if (text.trim() === '') return { kind: 'sections', sections: emptySections() };
  const sections = emptySections();
  const seen = new Set<SectionId>();
  let current: SectionId | undefined;
  let lines: string[] = [];
  let fence: string | undefined;
  const flush = () => {
    if (current !== undefined) sections[current] = lines.join('\n').trim();
    lines = [];
  };
  for (const line of text.split('\n')) {
    const marker = FENCE.exec(line)?.[1];
    if (fence !== undefined) {
      if (marker !== undefined && marker[0] === fence[0] && marker.length >= fence.length && line.trim() === marker) fence = undefined;
    } else if (marker !== undefined) fence = marker;
    const heading = fence === undefined && marker === undefined ? HEADING.exec(line) : null;
    if (heading) {
      const id = KNOWN.get(normalise(heading[1]));
      if (id === undefined || seen.has(id)) return { kind: 'free', text };
      flush();
      current = id;
      seen.add(id);
    } else if (current === undefined) {
      if (line.trim() !== '') return { kind: 'free', text };
    } else lines.push(line);
  }
  flush();
  return seen.size === 0 ? { kind: 'free', text } : { kind: 'sections', sections };
}
