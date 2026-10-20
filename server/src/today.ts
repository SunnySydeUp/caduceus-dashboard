// Today's review state (M8 #03): what is ready for review and the owner's visits. Hermes says what finished (Kanban tasks that reached Done, from every board;
// the runs the activity feed saw end); this file keeps only the owner's place in the store (`today_state`) and the markers of what they opened (`today_opened`).
// The list is derived on every ask and nothing of a task or a run is copied. The rules are pure, in `today-review.ts`.
import type { Hono } from 'hono';
import { isRecord } from '@caduceus/contracts/policy/guards';
import type { ReadyState, TodayVisit } from '@caduceus/contracts/today';
import type { AuthEnv } from './auth-routes.ts';
import type { CaduceusStore } from './caduceus-store.ts';
import type { HermesBackend } from './hermes-backend.ts';
import { readBody } from './hermes-proxy.ts';
import type { ActivityFeed } from './inbox-activity.ts';
import { boardTasks } from './inbox-work.ts';
import { MARKER_KEPT_MS, readyItems, recordVisit, runCandidates, taskCandidates, type BoardTasks, type OpenedMarker, type VisitState } from './today-review.ts';

const MAX_BODY = 4 * 1024;
/** An id or a stamp is a short reference (a board, a task id, a time); anything longer is not one. */
const MAX_REFERENCE = 256;

export interface TodayDeps {
  store: CaduceusStore;
  backend: HermesBackend;
  activity: ActivityFeed;
  now: () => number;
}

/** Every Hermes board and its tasks, as `GET /boards` and `GET /board` answer. Throws when Hermes does not answer. */
async function readBoards(backend: HermesBackend): Promise<BoardTasks[]> {
  const listed = await backend.fetch('/api/plugins/kanban/boards');
  if (!listed.ok) throw new Error(`Hermes answered HTTP ${listed.status}`);
  const body: unknown = await listed.json();
  const slugs = isRecord(body) && Array.isArray(body.boards) ? body.boards.flatMap((board) => (isRecord(board) && typeof board.slug === 'string' ? [board.slug] : [])) : [];
  // The boards are asked for together, so a Hermes with many boards costs one wait and not one for each.
  return Promise.all(
    slugs.map(async (slug): Promise<BoardTasks> => {
      const res = await backend.fetch(`/api/plugins/kanban/board?board=${encodeURIComponent(slug)}`);
      if (!res.ok) throw new Error(`Hermes answered HTTP ${res.status}`);
      return { slug, tasks: boardTasks(await res.json()).tasks };
    }),
  );
}

async function jsonBody(request: Request): Promise<unknown> {
  const raw = await readBody(request, MAX_BODY);
  if (raw === 'too-large') return undefined;
  try {
    return JSON.parse(Buffer.from(raw).toString('utf8'));
  } catch {
    return undefined;
  }
}

const reference = (value: unknown): value is string => typeof value === 'string' && value !== '' && value.length <= MAX_REFERENCE;

export function mountToday(app: Hono<AuthEnv>, { store, backend, activity, now }: TodayDeps): void {
  const { db } = store;
  // Today begins, for review, the first time Caduceus runs with it: work finished before that was never offered, and the owner would not thank it for a backlog.
  db.prepare('INSERT OR IGNORE INTO today_state (id, began_at) VALUES (1, ?)').run(now());

  app.get('/_caduceus/api/today/ready', async (c) => {
    let candidates;
    try {
      candidates = [...taskCandidates(await readBoards(backend)), ...runCandidates(activity.events())];
    } catch (error) {
      return c.json({ error: 'hermes-unavailable', message: error instanceof Error ? error.message : 'Hermes did not answer.' }, 502);
    }
    const { began_at: began } = db.prepare('SELECT began_at FROM today_state WHERE id = 1').get() as { began_at: number };
    const opened = db.prepare('SELECT id, stamp FROM today_opened').all() as unknown as OpenedMarker[];
    return c.json({ items: readyItems(candidates, opened, { began, now: now() }) } satisfies ReadyState);
  });

  app.post('/_caduceus/api/today/ready/opened', async (c) => {
    const body = await jsonBody(c.req.raw);
    if (!isRecord(body) || !reference(body.id) || !reference(body.stamp)) return c.json({ error: 'bad-request' }, 400);
    const at = now();
    db.prepare('INSERT INTO today_opened (id, stamp, at) VALUES (?, ?, ?) ON CONFLICT (id) DO UPDATE SET stamp = excluded.stamp, at = excluded.at').run(body.id, body.stamp, at);
    // A marker older than the window can no longer hide anything.
    db.prepare('DELETE FROM today_opened WHERE at < ?').run(at - MARKER_KEPT_MS);
    return c.json({ ok: true });
  });

  app.post('/_caduceus/api/today/visit', (c) => {
    const row = db.prepare('SELECT visit_at, previous_visit_at FROM today_state WHERE id = 1').get() as { visit_at: number | null; previous_visit_at: number | null };
    const before: VisitState = { visitAt: row.visit_at ?? undefined, previousVisitAt: row.previous_visit_at ?? undefined };
    const { state, visit } = recordVisit(before, now());
    db.prepare('UPDATE today_state SET visit_at = ?, previous_visit_at = ? WHERE id = 1').run(state.visitAt ?? null, state.previousVisitAt ?? null);
    return c.json(visit satisfies TodayVisit);
  });
}
