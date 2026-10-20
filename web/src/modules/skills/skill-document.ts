// A SKILL.md as the editor treats it (Agents › Skills), free of the DOM and of React: split into its YAML frontmatter and its Markdown
// body without touching a byte of either, checked the way Hermes checks it before it writes, and written fresh for a new skill.
//
// Hermes keeps frontmatter keys it has no use for (`version`, `metadata`, an author's own), and so must the editor: the text is
// never parsed and written back (that would lose comments, reorder keys and rewrite quoting). It is cut into pieces, one of which
// the owner edits, and joined again. `checkSkill` mirrors `_validate_frontmatter` of Hermes 0.21 (`tools/skill_manager_tool.py`) so
// a text that would be refused is refused here with Hermes's own words, before a save is attempted; Hermes still decides.

/** A SKILL.md cut in pieces; `joinSkill(splitSkill(text))` is exactly `text`. */
export interface SkillParts {
  /** A leading byte-order mark, if the file has one. */
  bom: string;
  /** What ends the opening `---` line: spaces and the line break. Empty when the frontmatter is empty and the fences touch. */
  lead: string;
  /** The YAML between the fences, as written, without the line break that ends the opening fence. */
  frontmatter: string;
  /** The closing `---` line with the line break before it and after it. */
  close: string;
  /** Everything after the closing fence: the Markdown. */
  body: string;
}

/** Hermes's own pattern for the end of the frontmatter. */
const CLOSE = /\r?\n---[ \t]*\r?\n/;

/** Cuts a SKILL.md at its frontmatter fences; `undefined` when it does not start with one or never closes it. */
export function splitSkill(text: string): SkillParts | undefined {
  const bom = text.startsWith('\uFEFF') ? '\uFEFF' : '';
  const rest = text.slice(bom.length);
  if (!rest.startsWith('---')) return undefined;
  const afterOpen = rest.slice(3);
  const end = CLOSE.exec(afterOpen);
  if (!end) return undefined;
  const middle = afterOpen.slice(0, end.index);
  const lead = /^[ \t]*\r?\n/.exec(middle)?.[0] ?? '';
  if (lead === '' && middle !== '') return undefined;
  return { bom, lead, frontmatter: middle.slice(lead.length), close: end[0], body: afterOpen.slice(end.index + end[0].length) };
}

/** The pieces as one text again. A frontmatter written where there was none gets its line break after the opening fence. */
export function joinSkill({ bom, lead, frontmatter, close, body }: SkillParts): string {
  return `${bom}---${lead === '' && frontmatter !== '' ? '\n' : lead}${frontmatter}${close}${body}`;
}

const MAX_NAME_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 1024;
/** What a new skill's description may take of Hermes's skill index (`SKILL_PROMPT_DESC_LIMIT`): longer ones lose their routing signal. */
export const NEW_DESCRIPTION_LIMIT = 60;
const MAX_CONTENT_CHARS = 100_000;
const NAME_RULE = 'Use lowercase letters, numbers, hyphens, dots, and underscores.';
const IDENTIFIER = /^[a-z0-9][a-z0-9._-]*$/;

/**
 * Whether a new skill's name and category are ones Hermes takes, in Hermes's words; `undefined` when they are. A category is
 * optional and is a single folder name.
 */
export function checkSkillIdentity({ name, category }: { name: string; category: string }): string | undefined {
  if (name === '') return 'Skill name is required.';
  if (name.length > MAX_NAME_LENGTH) return `Skill name exceeds ${MAX_NAME_LENGTH} characters.`;
  if (!IDENTIFIER.test(name)) return `Invalid skill name '${name}'. ${NAME_RULE} Must start with a letter or digit.`;
  const folder = category.trim();
  if (folder === '') return undefined;
  if (folder.length > MAX_NAME_LENGTH) return `Category exceeds ${MAX_NAME_LENGTH} characters.`;
  if (folder.includes('/') || folder.includes('\\') || !IDENTIFIER.test(folder)) return `Invalid category '${folder}'. ${NAME_RULE} Categories must be a single directory name.`;
  return undefined;
}

/**
 * Hermes's checks of a SKILL.md, in its order and its words: not empty, starts with frontmatter that closes and is a YAML mapping
 * with a `name` and a `description` of a fitting length, has a body, and is not too large. `isNew` adds the budget a new skill's
 * description must fit. Returns the reason it would be refused, or `undefined`. YAML is loaded when first needed.
 */
export async function checkSkill(text: string, { isNew }: { isNew: boolean }): Promise<string | undefined> {
  if (text.trim() === '') return 'Content cannot be empty.';
  const content = text.replace(/^\uFEFF+/, '');
  if (!content.startsWith('---')) return 'SKILL.md must start with YAML frontmatter (---). See existing skills for format.';
  const end = /\n---\s*\n/.exec(content.slice(3));
  if (!end) return 'SKILL.md frontmatter is not closed. Ensure you have a closing \'---\' line.';
  let parsed: unknown;
  try {
    // Loaded here, not at the top, to keep YAML out of the app's first load (the JS budget). PyYAML, which Hermes uses, lets a key repeat (the last one wins); so does this.
    parsed = (await import('yaml')).parse(content.slice(3, end.index + 3), { uniqueKeys: false });
  } catch (error) {
    return `YAML frontmatter parse error: ${error instanceof Error ? error.message : String(error)}`;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return 'Frontmatter must be a YAML mapping (key: value pairs).';
  const fields = parsed as Record<string, unknown>;
  for (const field of ['name', 'description']) if (!(field in fields)) return `Frontmatter must include '${field}' field.`;
  const description = String(fields.description);
  if (description.length > MAX_DESCRIPTION_LENGTH) return `Description exceeds ${MAX_DESCRIPTION_LENGTH} characters.`;
  const unquoted = description.trim().replace(/^['"]+|['"]+$/g, '');
  if (isNew && unquoted.length > NEW_DESCRIPTION_LIMIT) {
    return `Description is ${description.trim().length} chars — new skills must fit the ${NEW_DESCRIPTION_LIMIT}-char system-prompt budget (one sentence, trigger first, ends with a period). The skill index truncates longer descriptions to ${NEW_DESCRIPTION_LIMIT - 3} chars + '...', destroying the routing signal. Move detail into the skill body.`;
  }
  if (content.slice(3 + end.index + end[0].length).trim() === '') return 'SKILL.md must have content after the frontmatter (instructions, procedures, etc.).';
  const length = [...text].length;
  if (length > MAX_CONTENT_CHARS) {
    return `SKILL.md content is ${length.toLocaleString('en-US')} characters (limit: ${MAX_CONTENT_CHARS.toLocaleString('en-US')}). Consider splitting into a smaller SKILL.md with supporting files in references/ or templates/.`;
  }
  return undefined;
}

export interface NewSkill {
  name: string;
  description: string;
  /** More frontmatter, as the owner wrote it (YAML lines); put after `name` and `description` exactly as given. */
  extra: string;
  body: string;
}

/** The SKILL.md of a new skill: `name` and `description` (quoted where YAML would misread them), the owner's other keys, a blank line, the body. */
export async function newSkillText({ name, description, extra, body }: NewSkill): Promise<string> {
  // Loaded when first needed, as above.
  const head = (await import('yaml')).stringify({ name, description }, { singleQuote: true, lineWidth: 0 });
  const more = extra.trim() === '' ? '' : extra.endsWith('\n') ? extra : `${extra}\n`;
  return `---\n${head}${more}---\n\n${body}`;
}
