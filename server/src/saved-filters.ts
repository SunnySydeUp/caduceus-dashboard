// The owner's saved task filters (M3 #03): Caduceus-only, kept in its store as a name and a filter definition (the conditions a
// task must meet, see `contracts/task-filters.ts`). A filter never holds a task: the page applies the definition to what Hermes
// answers, so nothing of Kanban is copied here (D1).
import { randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import { MAX_SAVED_FILTERS, readFilterDefinition, readFilterName, type FilterDefinition, type SavedFilter, type SavedFilters } from '@caduceus/contracts/task-filters';
import { isRecord } from '@caduceus/contracts/policy/guards';
import type { AuthEnv } from './auth-routes.ts';
import type { CaduceusStore } from './caduceus-store.ts';

interface Row {
  id: string;
  name: string;
  definition: string;
}

export function mountSavedFilters(app: Hono<AuthEnv>, store: CaduceusStore): void {
  const { db } = store;
  const toFilter = (row: Row): SavedFilter => ({ id: row.id, name: row.name, definition: JSON.parse(row.definition) as FilterDefinition });
  const find = (id: string) => db.prepare('SELECT id, name, definition FROM saved_filters WHERE id = ?').get(id) as Row | undefined;

  app.get('/_caduceus/api/work/filters', (c) => {
    const rows = db.prepare('SELECT id, name, definition FROM saved_filters ORDER BY position').all() as unknown as Row[];
    return c.json({ filters: rows.map(toFilter) } satisfies SavedFilters);
  });

  app.post('/_caduceus/api/work/filters', async (c) => {
    const body: unknown = await c.req.json().catch(() => undefined);
    const name = isRecord(body) ? readFilterName(body.name) : undefined;
    const definition = isRecord(body) ? readFilterDefinition(body.definition) : undefined;
    if (name === undefined || definition === undefined) return c.json({ error: 'bad-request' }, 400);
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM saved_filters').get() as { n: number };
    if (n >= MAX_SAVED_FILTERS) return c.json({ error: 'too-many-filters' }, 409);
    const id = randomUUID();
    db.prepare('INSERT INTO saved_filters (id, name, definition) VALUES (?, ?, ?)').run(id, name, JSON.stringify(definition));
    return c.json({ id, name, definition } satisfies SavedFilter, 201);
  });

  app.put('/_caduceus/api/work/filters/:id', async (c) => {
    const body: unknown = await c.req.json().catch(() => undefined);
    const rename = isRecord(body) && 'name' in body ? readFilterName(body.name) : undefined;
    const redefine = isRecord(body) && 'definition' in body ? readFilterDefinition(body.definition) : undefined;
    const wantsName = isRecord(body) && 'name' in body;
    const wantsDefinition = isRecord(body) && 'definition' in body;
    if ((!wantsName && !wantsDefinition) || (wantsName && rename === undefined) || (wantsDefinition && redefine === undefined)) return c.json({ error: 'bad-request' }, 400);
    const current = find(c.req.param('id'));
    if (!current) return c.json({ error: 'not-found' }, 404);
    const next = { ...current, name: rename ?? current.name, definition: redefine ? JSON.stringify(redefine) : current.definition };
    db.prepare('UPDATE saved_filters SET name = ?, definition = ? WHERE id = ?').run(next.name, next.definition, next.id);
    return c.json(toFilter(next) satisfies SavedFilter);
  });

  app.delete('/_caduceus/api/work/filters/:id', (c) => {
    const { changes } = db.prepare('DELETE FROM saved_filters WHERE id = ?').run(c.req.param('id'));
    return changes === 0 ? c.json({ error: 'not-found' }, 404) : c.body(null, 204);
  });
}
