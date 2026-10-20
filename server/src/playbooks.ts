// The playbook library: task templates, multi-stage playbooks and the categories that group them (M3 #08, M6 #01; work model §2.3). A definition
// is a YAML file under `<Hermes root home>/caduceus/playbooks/<id>.yaml` (written atomically, readable by the owner only), so `hermes backup`
// carries it and M6's playbook engine reads the same files. Every version is also kept, never changed, as `playbooks/versions/<id>@<n>.yaml`:
// a run is tagged with the version it started from, and deleting a playbook leaves those, so a run in flight keeps its text. The seeded
// playbooks (`playbook-seeds.ts`) are in code, read-only and version 1. The categories are Caduceus's own rows, never Kanban's `tenant`, and a
// definition names its category by id so renaming one touches no file. Nothing here is ever sent to Hermes except questions (which profiles and
// skills exist): a playbook only becomes tasks when it is run (`playbook-engine.ts`).
import fs from 'node:fs';
import path from 'node:path';
import type { Hono } from 'hono';
import { parse, stringify } from 'yaml';
import { ID_PATTERN, readPlaybook, type Playbook, type TemplateCategory, type TemplateLibrary } from '@caduceus/contracts/playbooks';
import { isRecord } from '@caduceus/contracts/policy/guards';
import type { AuthEnv } from './auth-routes.ts';
import type { CaduceusStore } from './caduceus-store.ts';
import type { HermesBackend } from './hermes-backend.ts';
import { gateRequest } from './policy-gate.ts';
import { readPlaybookYaml, referenceWarnings, type KnownReferences, type LocatedProblem } from './playbook-yaml.ts';
import { SEED_PLAYBOOKS } from './playbook-seeds.ts';
import type { RestPolicy } from './policy.ts';
import { SEED_CATEGORIES, SEED_TEMPLATES } from './template-seeds.ts';

const SEEDED_KEY = 'work.templates-seeded';
const MAX_CATEGORY_NAME = 40;
const MAX_TEMPLATES = 200;
const MAX_CATEGORIES = 50;
const MAX_BODY = 1_000_000;
const ROUTE = '/_caduceus/api/work/playbooks';

/** `Weekly report (copy)` as an id: `weekly-report-copy`. */
function slug(name: unknown): string {
  const words = typeof name === 'string' ? name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') : '';
  return (words.slice(0, 40).replace(/-+$/, '') || 'template');
}

/** A category's name as stored: trimmed, one line, not empty, not long. */
function categoryName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const name = value.replace(/\s+/g, ' ').trim();
  return name === '' || name.length > MAX_CATEGORY_NAME ? undefined : name;
}

const yamlOf = (playbook: Playbook): string => stringify(playbook, { lineWidth: 0 });

/** What Hermes answers to a read, or `undefined` when it does not answer well. */
async function askHermes(backend: HermesBackend, route: string): Promise<unknown> {
  try {
    const answer = await backend.fetch(route);
    return answer.ok ? ((await answer.json()) as unknown) : undefined;
  } catch {
    return undefined;
  }
}

export interface PlaybookRoutesDeps {
  store: CaduceusStore;
  backend: HermesBackend;
  policy: RestPolicy;
}

/** The definitions the playbook engine reads: one version of a playbook, a seed included. */
export interface PlaybookLibrary {
  get(id: string, version: number): Playbook | undefined;
  /** The definition a new run starts from: the seed, or the owner's latest version. */
  current(id: string): Playbook | undefined;
}

export function mountPlaybooks(app: Hono<AuthEnv>, { store, backend, policy }: PlaybookRoutesDeps): PlaybookLibrary {
  const { db } = store;
  const dir = path.join(store.dir, 'playbooks');
  const versions = path.join(dir, 'versions');
  fs.mkdirSync(versions, { recursive: true, mode: 0o700 });
  // The mode above only applies to a new folder, and a restored backup comes back with default modes.
  fs.chmodSync(dir, 0o700);
  fs.chmodSync(versions, 0o700);
  const fileOf = (id: string) => path.join(dir, `${id}.yaml`);
  const versionFile = (id: string, version: number) => path.join(versions, `${id}@${version}.yaml`);
  const seedOf = (id: string) => SEED_PLAYBOOKS.find((seed) => seed.id === id);
  const files = () => fs.readdirSync(dir).filter((name) => name.endsWith('.yaml'));

  const categories = (): TemplateCategory[] => db.prepare('SELECT id, name FROM template_categories ORDER BY position').all() as unknown as TemplateCategory[];
  const insertCategory = (id: string, name: string) => {
    const { next } = db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS next FROM template_categories').get() as { next: number };
    db.prepare('INSERT INTO template_categories (id, name, position) VALUES (?, ?, ?)').run(id, name, next);
  };

  /** Keeps this version for good, unless it is kept already: a version file is never rewritten. */
  function archive(playbook: Playbook): void {
    try {
      fs.writeFileSync(versionFile(playbook.id, playbook.version), yamlOf(playbook), { flag: 'wx', mode: 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }

  /** Writes a definition next to its file and renames it into place, so a reader never sees half of one. */
  function write(playbook: Playbook, { exclusive = false } = {}): void {
    const file = fileOf(playbook.id);
    const partial = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(partial, yamlOf(playbook), { mode: 0o600 });
    try {
      if (exclusive) fs.linkSync(partial, file);
      else fs.renameSync(partial, file);
    } finally {
      fs.rmSync(partial, { force: true });
    }
    archive(playbook);
  }

  function readFile(file: string, id: string): Playbook | undefined {
    try {
      const reading = readPlaybook(parse(fs.readFileSync(file, 'utf8')));
      return reading.playbook?.id === id ? reading.playbook : undefined;
    } catch {
      return undefined;
    }
  }

  /** The owner's current definition of `id`, or the seed of that id. */
  const read = (id: string): Playbook | undefined => (ID_PATTERN.test(id) ? (seedOf(id) ?? readFile(fileOf(id), id)) : undefined);

  /** One version of `id`: the seed, the kept file, or, for a definition saved before versions were kept, the current file when it is that version. */
  function readVersion(id: string, version: number): Playbook | undefined {
    if (!ID_PATTERN.test(id)) return undefined;
    const seed = seedOf(id);
    if (seed) return seed.version === version ? seed : undefined;
    const current = readFile(fileOf(id), id);
    if (current?.version === version) return current;
    const kept = readFile(versionFile(id, version), id);
    return kept?.version === version ? kept : undefined;
  }

  /** The versions of `id` that can be read, oldest first. */
  function versionsOf(id: string): number[] {
    const numbers = new Set<number>(seedOf(id) ? [seedOf(id)!.version] : []);
    const current = readFile(fileOf(id), id);
    if (current) numbers.add(current.version);
    for (const name of fs.readdirSync(versions)) {
      const match = /^(.+)@([1-9][0-9]*)\.yaml$/.exec(name);
      if (match?.[1] === id && readFile(path.join(versions, name), id)) numbers.add(Number(match[2]));
    }
    return [...numbers].sort((a, b) => a - b);
  }

  function library(): TemplateLibrary {
    const found: Playbook[] = [];
    const problems: string[] = [];
    for (const file of files().sort()) {
      try {
        const reading = readPlaybook(parse(fs.readFileSync(path.join(dir, file), 'utf8')));
        if (reading.playbook === undefined) problems.push(`${file}: ${reading.problems[0]}`);
        else if (`${reading.playbook.id}.yaml` !== file) problems.push(`${file}: its id is “${reading.playbook.id}”, which is not the file’s name.`);
        else found.push(reading.playbook);
      } catch (error) {
        problems.push(`${file}: ${error instanceof Error ? error.message.split('\n')[0] : 'cannot be read.'}`);
      }
    }
    const list = categories();
    const rank = (playbook: Playbook) => {
      const index = list.findIndex((category) => category.id === playbook.category);
      return index < 0 ? list.length : index;
    };
    found.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
    return { categories: list, templates: found, seeds: [...SEED_PLAYBOOKS], problems };
  }

  // First run: the seeded categories and templates. Once only, so what the owner deletes or renames stays that way.
  if (!db.prepare('SELECT 1 FROM settings WHERE key = ?').get(SEEDED_KEY)) {
    db.exec('BEGIN');
    for (const category of SEED_CATEGORIES) insertCategory(category.id, category.name);
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(SEEDED_KEY, '1');
    db.exec('COMMIT');
    for (const template of SEED_TEMPLATES) write(template);
  }

  /** The definition a request body describes, as it would be stored, or the problems with it. `id` and `version` are the server's to give unless an undo sends them back. */
  function definition(body: unknown, id: string, version: number): { playbook: Playbook } | { problems: string[] } {
    const source = isRecord(body) ? { ...body, id, version } : body;
    const reading = readPlaybook(isRecord(source) ? { inputs: [], edges: [], ...source } : source);
    if (reading.playbook === undefined) return { problems: reading.problems };
    if (!categories().some((category) => category.id === reading.playbook.category)) return { problems: [`category: there is no category “${reading.playbook.category}”.`] };
    return { playbook: reading.playbook };
  }

  /** The profiles Hermes has, and the skills of each profile that a definition's stages name (the default profile's when a stage names none). */
  async function knownReferences(playbook: Playbook): Promise<KnownReferences> {
    const listed = await askHermes(backend, '/api/profiles');
    const profiles = new Set((isRecord(listed) && Array.isArray(listed.profiles) ? listed.profiles : []).flatMap((entry) => (isRecord(entry) && typeof entry.name === 'string' ? [entry.name] : [])));
    const skills = new Map<string, ReadonlySet<string>>();
    for (const profile of new Set(playbook.stages.filter((stage) => (stage.skills ?? []).length > 0).map((stage) => stage.assignee ?? 'default'))) {
      if (profile !== 'default' && !profiles.has(profile)) continue;
      const listing = await askHermes(backend, `/api/skills?profile=${encodeURIComponent(profile)}`);
      if (Array.isArray(listing)) skills.set(profile, new Set(listing.flatMap((entry) => (isRecord(entry) && typeof entry.name === 'string' ? [entry.name] : []))));
    }
    // Hermes that did not answer says nothing about a profile, so nothing is warned about.
    return { profiles: profiles.size === 0 ? new Set(playbook.stages.flatMap((stage) => (stage.assignee ? [stage.assignee] : []))) : profiles, skills };
  }

  /** What a definition's detail answers with: the text, the versions, and what Hermes does not know of what it names. */
  async function detail(playbook: Playbook, lineOf?: (place: readonly (string | number)[]) => number | undefined) {
    const warnings = referenceWarnings(playbook, await knownReferences(playbook)).map(({ stage, path: place, message }) => {
      const line = lineOf?.(place);
      return { stage, message, ...(line === undefined ? {} : { line }) };
    });
    return { playbook, yaml: yamlOf(playbook), seed: seedOf(playbook.id) !== undefined, versions: versionsOf(playbook.id), warnings };
  }

  const badRequest = (problems: LocatedProblem[]) => ({ error: 'bad-request', problems: problems.map((problem) => problem.message), lines: problems.map((problem) => problem.line ?? null) });

  app.get(ROUTE, (c) => c.json(library()));

  // Registered before `/:id`, which would otherwise take `check` for an id.
  app.post(`${ROUTE}/check`, async (c) => {
    const body: unknown = await c.req.json().catch(() => undefined);
    if (!isRecord(body) || typeof body.yaml !== 'string') return c.json({ error: 'bad-request' }, 400);
    const reading = readPlaybookYaml(body.yaml);
    if (reading.playbook === undefined) return c.json({ errors: reading.errors, warnings: [] });
    const { warnings } = await detail(reading.playbook, reading.lineOf);
    return c.json({ errors: [], warnings });
  });

  app.post(ROUTE, async (c) => {
    const body: unknown = await c.req.json().catch(() => undefined);
    if (files().length >= MAX_TEMPLATES) return c.json({ error: 'too-many-templates' }, 409);
    // An undo sends the deleted definition back with its id and version; a new template gets an id from its name and starts at version 1.
    const given = isRecord(body) && typeof body.id === 'string' && ID_PATTERN.test(body.id) ? body.id : undefined;
    if (given !== undefined && seedOf(given)) return c.json({ error: 'seed' }, 409);
    const version = given !== undefined && isRecord(body) && Number.isInteger(body.version) && (body.version as number) >= 1 ? (body.version as number) : 1;
    let id = given ?? slug(isRecord(body) ? body.name : undefined);
    if (given === undefined) for (let n = 2; fs.existsSync(fileOf(id)) || seedOf(id); n += 1) id = `${slug(isRecord(body) ? body.name : undefined)}-${n}`;
    const made = definition(body, id, version);
    if ('problems' in made) return c.json({ error: 'bad-request', problems: made.problems }, 400);
    try {
      write(made.playbook, { exclusive: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return c.json({ error: 'exists' }, 409);
      throw error;
    }
    return c.json(made.playbook, 201);
  });

  app.get(`${ROUTE}/:id`, async (c) => {
    const playbook = read(c.req.param('id'));
    return playbook ? c.json(await detail(playbook)) : c.json({ error: 'not-found' }, 404);
  });

  app.get(`${ROUTE}/:id/versions/:version`, async (c) => {
    const playbook = readVersion(c.req.param('id'), Number(c.req.param('version')));
    return playbook ? c.json(await detail(playbook)) : c.json({ error: 'not-found' }, 404);
  });

  // Saving is a new version: the owner confirms it (T1), and the file it replaces stays readable as the version it was.
  app.put(`${ROUTE}/:id`, async (c) => {
    const gated = await gateRequest(policy, c, 'PUT', MAX_BODY);
    if ('refusal' in gated) return gated.refusal;
    const id = c.req.param('id');
    if (seedOf(id)) return c.json({ error: 'seed' }, 403);
    const current = read(id);
    if (!current) return c.json({ error: 'not-found' }, 404);
    let body = gated.body;
    if (isRecord(body) && typeof body.yaml === 'string') {
      const reading = readPlaybookYaml(body.yaml);
      if (reading.playbook === undefined) return c.json(badRequest(reading.errors), 400);
      if (reading.playbook.id !== id) return c.json(badRequest([{ message: `id: it is “${reading.playbook.id}”, but this playbook is “${id}”. Duplicate it to make another.` }]), 400);
      body = reading.playbook;
    }
    const made = definition(body, current.id, current.version + 1);
    if ('problems' in made) return c.json({ error: 'bad-request', problems: made.problems }, 400);
    archive(current);
    write(made.playbook);
    return c.json(made.playbook);
  });

  app.delete(`${ROUTE}/:id`, async (c) => {
    const gated = await gateRequest(policy, c, 'DELETE', MAX_BODY);
    if ('refusal' in gated) return gated.refusal;
    const id = c.req.param('id');
    if (seedOf(id)) return c.json({ error: 'seed' }, 403);
    const current = read(id);
    if (!current) return c.json({ error: 'not-found' }, 404);
    archive(current);
    fs.rmSync(fileOf(id));
    return c.body(null, 204);
  });

  app.get('/_caduceus/api/work/template-categories', (c) => c.json({ categories: categories() }));

  app.post('/_caduceus/api/work/template-categories', async (c) => {
    const body: unknown = await c.req.json().catch(() => undefined);
    const name = isRecord(body) ? categoryName(body.name) : undefined;
    if (name === undefined) return c.json({ error: 'bad-request' }, 400);
    const taken = categories();
    if (taken.length >= MAX_CATEGORIES) return c.json({ error: 'too-many-categories' }, 409);
    if (taken.some((category) => category.name.toLowerCase() === name.toLowerCase())) return c.json({ error: 'duplicate-name' }, 409);
    let id = slug(name);
    for (let n = 2; taken.some((category) => category.id === id); n += 1) id = `${slug(name)}-${n}`;
    insertCategory(id, name);
    return c.json({ id, name } satisfies TemplateCategory, 201);
  });

  // Registered before `/:id`, which would otherwise take `order` for an id.
  app.put('/_caduceus/api/work/template-categories/order', async (c) => {
    const body: unknown = await c.req.json().catch(() => undefined);
    const ids = isRecord(body) && Array.isArray(body.ids) ? body.ids : undefined;
    const known = categories().map((category) => category.id);
    if (ids === undefined || ids.length !== known.length || new Set(ids).size !== ids.length || !ids.every((id) => typeof id === 'string' && known.includes(id))) return c.json({ error: 'bad-request' }, 400);
    db.exec('BEGIN');
    ids.forEach((id, index) => db.prepare('UPDATE template_categories SET position = ? WHERE id = ?').run(index + 1, id as string));
    db.exec('COMMIT');
    return c.json({ categories: categories() });
  });

  app.put('/_caduceus/api/work/template-categories/:id', async (c) => {
    const id = c.req.param('id');
    const body: unknown = await c.req.json().catch(() => undefined);
    const name = isRecord(body) ? categoryName(body.name) : undefined;
    if (name === undefined) return c.json({ error: 'bad-request' }, 400);
    const all = categories();
    if (!all.some((category) => category.id === id)) return c.json({ error: 'not-found' }, 404);
    if (all.some((category) => category.id !== id && category.name.toLowerCase() === name.toLowerCase())) return c.json({ error: 'duplicate-name' }, 409);
    db.prepare('UPDATE template_categories SET name = ? WHERE id = ?').run(name, id);
    return c.json({ id, name } satisfies TemplateCategory);
  });

  app.delete('/_caduceus/api/work/template-categories/:id', (c) => {
    const id = c.req.param('id');
    if (!categories().some((category) => category.id === id)) return c.json({ error: 'not-found' }, 404);
    if (library().templates.some((template) => template.category === id)) return c.json({ error: 'not-empty' }, 409);
    db.prepare('DELETE FROM template_categories WHERE id = ?').run(id);
    return c.body(null, 204);
  });

  return { get: readVersion, current: read };
}
