// The owner's saved prompts (M1 #11): a name, the text, tags and an optional profile, kept in the Caduceus store (R5). A prompt is only ever text the owner
// chose to keep: it is inserted into the composer by the page and goes to Hermes when the owner presses Send, like any typed words. A prompt that holds a secret
// is refused: the store is in every backup and on every device.
import { randomUUID } from 'node:crypto';
import type { Context, Hono } from 'hono';
import { MAX_SAVED_PROMPTS, readPromptInput, secretIn, type SavedPrompt, type SavedPromptInput, type SavedPromptList } from '@caduceus/contracts/chat-drafts';
import type { AuthEnv } from './auth-routes.ts';
import type { CaduceusStore } from './caduceus-store.ts';
import { READ_ONLY_MESSAGE } from './policy.ts';
import type { ReadOnlyMode } from './read-only.ts';

interface Row {
  id: string;
  name: string;
  text: string;
  tags: string;
  profile: string | null;
  updated_at: number;
}

const COLUMNS = 'id, name, text, tags, profile, updated_at';
const ROUTE = '/_caduceus/api/chat/prompts';

export function mountSavedPrompts(app: Hono<AuthEnv>, store: CaduceusStore, now: () => number, readOnly: ReadOnlyMode): void {
  const { db } = store;
  const toPrompt = (row: Row): SavedPrompt => ({ id: row.id, name: row.name, text: row.text, tags: JSON.parse(row.tags) as string[], profile: row.profile, updatedAt: row.updated_at });
  const find = (id: string) => db.prepare(`SELECT ${COLUMNS} FROM saved_prompts WHERE id = ?`).get(id) as Row | undefined;
  const refuseWhileReadOnly = (c: Context<AuthEnv, string>) => (readOnly.enabled() ? c.json({ error: 'read-only', message: READ_ONLY_MESSAGE }, 403) : undefined);
  /** The prompt a request carries, or the answer that refuses it. */
  const readInput = async (c: Context<AuthEnv, string>): Promise<SavedPromptInput | Response> => {
    const input = readPromptInput(await c.req.json().catch(() => undefined));
    if (!input) return c.json({ error: 'bad-request' }, 400);
    const secret = secretIn(`${input.name}\n${input.text}`);
    return secret ? c.json({ error: 'secret', what: secret, message: `This prompt is not saved: it looks like it holds ${secret}. Caduceus never keeps those.` }, 422) : input;
  };

  app.get(ROUTE, (c) => {
    const profile = c.req.query('profile');
    // A prompt scoped to another profile is not shown; without a profile, every prompt is.
    const rows = (profile
      ? db.prepare(`SELECT ${COLUMNS} FROM saved_prompts WHERE profile IS NULL OR profile = ? ORDER BY name COLLATE NOCASE, position`).all(profile)
      : db.prepare(`SELECT ${COLUMNS} FROM saved_prompts ORDER BY name COLLATE NOCASE, position`).all()) as unknown as Row[];
    return c.json({ prompts: rows.map(toPrompt) } satisfies SavedPromptList);
  });

  app.post(ROUTE, async (c) => {
    const refused = refuseWhileReadOnly(c);
    if (refused) return refused;
    const input = await readInput(c);
    if (input instanceof Response) return input;
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM saved_prompts').get() as { n: number };
    if (n >= MAX_SAVED_PROMPTS) return c.json({ error: 'too-many', message: `Caduceus keeps up to ${MAX_SAVED_PROMPTS} saved prompts. Delete some first.` }, 409);
    const id = randomUUID();
    db.prepare('INSERT INTO saved_prompts (id, name, text, tags, profile, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, input.name, input.text, JSON.stringify(input.tags), input.profile, now());
    return c.json(toPrompt(find(id)!), 201);
  });

  app.put(`${ROUTE}/:id`, async (c) => {
    const refused = refuseWhileReadOnly(c);
    if (refused) return refused;
    const input = await readInput(c);
    if (input instanceof Response) return input;
    const id = c.req.param('id');
    if (!find(id)) return c.json({ error: 'not-found' }, 404);
    db.prepare('UPDATE saved_prompts SET name = ?, text = ?, tags = ?, profile = ?, updated_at = ? WHERE id = ?').run(input.name, input.text, JSON.stringify(input.tags), input.profile, now(), id);
    return c.json(toPrompt(find(id)!));
  });

  app.delete(`${ROUTE}/:id`, (c) => {
    const refused = refuseWhileReadOnly(c);
    if (refused) return refused;
    const { changes } = db.prepare('DELETE FROM saved_prompts WHERE id = ?').run(c.req.param('id'));
    return changes === 0 ? c.json({ error: 'not-found' }, 404) : c.body(null, 204);
  });
}
