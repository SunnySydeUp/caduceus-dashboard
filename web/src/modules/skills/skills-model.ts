// Agents › Skills › Installed, as pure logic (no DOM, no React): how Hermes's skills endpoint reads, the list's search and category
// filter as they live in the URL, and the requests the page sends. Every skill, its state and its usage count is Hermes's; nothing
// here is kept between visits.

/** Where a skill came from, as Hermes classifies it: `hub` was installed from the skills hub, `bundled` ships with Hermes, `agent` is local (hand-made or written by the agent). */
export type Provenance = 'hub' | 'bundled' | 'agent';

export interface SkillRow {
  name: string;
  description: string;
  /** The folder the skill sits in under the profile's skills; empty when it has none. */
  category: string;
  enabled: boolean;
  /** Hermes's own usage count for the skill: the only usage number Hermes gives. */
  usage: number;
  provenance: Provenance;
}

const text = (value: unknown) => (typeof value === 'string' ? value : '');

/** The skills in Hermes's `GET /api/skills` answer. What is not a skill with a name is left out. */
export function parseSkills(body: unknown): SkillRow[] {
  if (!Array.isArray(body)) return [];
  return body.flatMap((item): SkillRow[] => {
    if (typeof item !== 'object' || item === null) return [];
    const { name, description, category, enabled, usage, provenance } = item as Record<string, unknown>;
    if (typeof name !== 'string' || name === '') return [];
    return [
      {
        name,
        description: text(description),
        category: text(category),
        enabled: enabled !== false,
        usage: typeof usage === 'number' && Number.isFinite(usage) ? usage : 0,
        provenance: provenance === 'hub' || provenance === 'bundled' ? provenance : 'agent',
      },
    ];
  });
}

/** Hermes's skills for one profile. */
export const listPath = (profile: string) => `/api/skills?profile=${encodeURIComponent(profile)}`;

/** What the category filter says for the skills that sit in no folder. It is a value in the URL, so no real category can be written like it. */
export const UNCATEGORISED = '~none';

export type SkillState = 'all' | 'enabled' | 'disabled';

/** The search, category and state of the list: all three live in the URL (`?q=notes&category=writing&state=enabled`). */
export interface SkillsView {
  q: string;
  category: string;
  state: SkillState;
}

const DEFAULT_VIEW: SkillsView = { q: '', category: '', state: 'all' };

/** The list's view from the URL's query; a value it does not know reads as the default. */
export function readSkillsView(search: Record<string, unknown>): SkillsView {
  const { q, category, state } = search;
  return {
    q: typeof q === 'string' ? q : DEFAULT_VIEW.q,
    category: typeof category === 'string' ? category : DEFAULT_VIEW.category,
    state: state === 'enabled' || state === 'disabled' ? state : DEFAULT_VIEW.state,
  };
}

/** The query for a view: only what differs from the default, so an unfiltered list has a clean address. */
export function skillsSearch(view: SkillsView): Record<string, string> {
  return {
    ...(view.q.trim() !== '' && { q: view.q }),
    ...(view.category !== '' && { category: view.category }),
    ...(view.state !== 'all' && { state: view.state }),
  };
}

/** The skills a view shows, in Hermes's order. Search matches the name, the description and the category. */
export function filterSkills(skills: readonly SkillRow[], { q, category, state }: SkillsView): SkillRow[] {
  const needle = q.trim().toLowerCase();
  return skills.filter((skill) => {
    if (category !== '' && (category === UNCATEGORISED ? skill.category !== '' : skill.category !== category)) return false;
    if (state !== 'all' && skill.enabled !== (state === 'enabled')) return false;
    return needle === '' || [skill.name, skill.description, skill.category].some((field) => field.toLowerCase().includes(needle));
  });
}

/** The categories of the whole list with how many skills each holds: sorted by name, the uncategorised last. */
export function categoriesOf(skills: readonly SkillRow[]): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const { category } of skills) counts.set(category === '' ? UNCATEGORISED : category, (counts.get(category === '' ? UNCATEGORISED : category) ?? 0) + 1);
  return [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => (a.name === UNCATEGORISED ? 1 : b.name === UNCATEGORISED ? -1 : a.name.localeCompare(b.name)));
}

/** A request to Hermes, as the page hands it to `fetchTiered`. */
export interface HermesRequest {
  method: string;
  path: string;
  body?: Record<string, unknown>;
}

/** Switches a skill on or off for the profile (Tier 0): Hermes keeps the list of disabled skills in the profile's config. */
export const toggleRequest = (profile: string, name: string, enabled: boolean): HermesRequest => ({
  method: 'PUT',
  path: `/api/skills/toggle?profile=${encodeURIComponent(profile)}`,
  body: { name, enabled, profile },
});

/** One skill's SKILL.md in a profile, from Hermes. */
export const contentPath = (profile: string, name: string) => `/api/skills/content?name=${encodeURIComponent(name)}&profile=${encodeURIComponent(profile)}`;

export interface SkillContent {
  /** The whole SKILL.md, frontmatter included, as Hermes holds it. */
  content: string;
  /** The skill's folder on Hermes's disk: where its linked files are. */
  folder: string;
}

/** What Hermes's content endpoint answers: the text and the place of the SKILL.md (the skill's folder is the place's). */
export function readContent(body: unknown): SkillContent | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const { content, path } = body as { content?: unknown; path?: unknown };
  if (typeof content !== 'string' || typeof path !== 'string') return undefined;
  return { content, folder: path.slice(0, Math.max(0, path.lastIndexOf('/'))) };
}

/** A folder's entries through Hermes's file listing (a read, as is everything that shows a linked file). */
export const folderPath = (folder: string) => `/api/fs/list?path=${encodeURIComponent(folder)}`;

/** A file's text through Hermes's file reader. */
export const filePath = (file: string) => `/api/fs/read-text?path=${encodeURIComponent(file)}`;

export interface FolderEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

export function parseFolder(body: unknown): FolderEntry[] {
  const entries = typeof body === 'object' && body !== null ? (body as { entries?: unknown }).entries : undefined;
  if (!Array.isArray(entries)) return [];
  return entries.flatMap((entry): FolderEntry[] => {
    const { name, path, isDirectory } = (entry ?? {}) as Record<string, unknown>;
    return typeof name === 'string' && typeof path === 'string' ? [{ name, path, isDirectory: isDirectory === true }] : [];
  });
}

export interface LinkedFile {
  /** Its place in the skill's folder: `references/api.md`. */
  name: string;
  /** Where Hermes has it, to open it. */
  path: string;
}

const MAX_DEPTH = 4;
const MAX_FILES = 200;

/**
 * The files in a skill's folder other than its SKILL.md (references, templates, scripts, assets, and anything the agent put
 * there), by their place in it, sorted. It looks at most four folders deep and lists at most 200: a skill with more is not one a
 * person reads file by file.
 */
export async function linkedFiles(folder: string, list: (folder: string) => Promise<FolderEntry[]>): Promise<LinkedFile[]> {
  const found: LinkedFile[] = [];
  const walk = async (at: string, prefix: string, depth: number): Promise<void> => {
    for (const entry of await list(at)) {
      if (found.length >= MAX_FILES) return;
      const name = `${prefix}${entry.name}`;
      if (!entry.isDirectory) {
        if (name !== 'SKILL.md') found.push({ name, path: entry.path });
      } else if (depth < MAX_DEPTH) {
        await walk(entry.path, `${name}/`, depth + 1);
      }
    }
  };
  await walk(folder, '', 1);
  return found.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

export interface FileText {
  text: string;
  /** Hermes could not show it as text. */
  binary: boolean;
  /** Hermes sent only the first part of a large file. */
  truncated: boolean;
  /** Its size in bytes. */
  size: number;
}

export function readFile(body: unknown): FileText | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const { text, binary, truncated, byteSize } = body as Record<string, unknown>;
  if (typeof text !== 'string') return undefined;
  return { text, binary: binary === true, truncated: truncated === true, size: typeof byteSize === 'number' ? byteSize : text.length };
}

/** Creates a skill (Tier 1). The text is the whole SKILL.md; Hermes writes it as it is, in the category's folder when there is one. */
export const createRequest = (profile: string, { name, category, content }: { name: string; category: string; content: string }): HermesRequest => ({
  method: 'POST',
  path: '/api/skills',
  body: { name, content, profile, ...(category.trim() !== '' && { category: category.trim() }) },
});

/** Replaces a skill's whole SKILL.md (Tier 1). Hermes writes the text exactly as sent. */
export const saveRequest = (profile: string, name: string, content: string): HermesRequest => ({
  method: 'PUT',
  path: '/api/skills/content',
  body: { name, content, profile },
});

/** What the owner can do to take a skill away: a hub skill is uninstalled, a local one (hand-made or the agent's own) is deleted, and a bundled one only switched off. */
export function removalOf(skill: SkillRow): 'uninstall' | 'delete' | 'none' {
  return skill.provenance === 'hub' ? 'uninstall' : skill.provenance === 'agent' ? 'delete' : 'none';
}

/** Uninstalls a hub skill from the profile (Tier 1). Hermes runs its own `skills uninstall` in the background and answers with the name of that action. */
export const uninstallRequest = (profile: string, name: string): HermesRequest => ({
  method: 'POST',
  path: `/api/skills/hub/uninstall?profile=${encodeURIComponent(profile)}`,
  body: { name, profile },
});

/** Deletes a local skill (Tier 1): Hermes's learning-graph delete, which archives a skill so that `hermes curator restore <name>` brings it back. */
export const deleteRequest = (profile: string, name: string): HermesRequest => ({
  method: 'DELETE',
  path: '/api/learning/node',
  body: { id: name, profile },
});

/** What Hermes says of a delete: it did it (and how to undo it), or it did not and why. */
export function readDeleteAnswer(body: unknown): { ok: boolean; message: string } {
  const { ok, message } = (typeof body === 'object' && body !== null ? body : {}) as { ok?: unknown; message?: unknown };
  return { ok: ok === true, message: typeof message === 'string' ? message : '' };
}

/** The state of a background action Hermes started (the uninstall). */
export const actionPath = (name: string) => `/api/actions/${encodeURIComponent(name)}/status`;

export type ActionOutcome = { kind: 'running' } | { kind: 'done' } | { kind: 'failed'; message: string };

/** Whether a background action is still running, finished well (exit code 0) or failed, with the last line it printed. */
export function readActionOutcome(body: unknown): ActionOutcome {
  const { running, exit_code: exitCode, lines } = (typeof body === 'object' && body !== null ? body : {}) as { running?: unknown; exit_code?: unknown; lines?: unknown };
  if (running !== false) return { kind: 'running' };
  if (exitCode === 0) return { kind: 'done' };
  const last = Array.isArray(lines) ? lines.filter((line): line is string => typeof line === 'string' && line.trim() !== '').at(-1) : undefined;
  return { kind: 'failed', message: last?.trim() || `Hermes’s uninstall stopped with exit code ${String(exitCode)}.` };
}
