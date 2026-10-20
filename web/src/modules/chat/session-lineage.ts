// The segments of one conversation (M1 #16): no DOM and no React. A messaging session Hermes carried on in a new session (it compressed the old
// one) is a chain of stored sessions, each linked to the one before by `parent_session_id`. The chain is read from Hermes's REST session rows
// and kept nowhere. A branch is a real alternative, not a segment: the link only counts when the parent ended by compression, as Hermes's own
// search treats it.

export interface Segment {
  id: string;
  title: string;
  startedAt: number;
}

export interface Lineage {
  /** Every segment, oldest first, the open one included. */
  segments: Segment[];
  /** Where the open one is among them. */
  index: number;
}

interface Row {
  id?: unknown;
  title?: unknown;
  started_at?: unknown;
  ended_at?: unknown;
  end_reason?: unknown;
  parent_session_id?: unknown;
}

/** Hermes's chains are a few segments long; a longer one is a loop in the data, and stops here. */
const MAX_SEGMENTS = 50;

const segmentOf = (row: Row, fallbackId: string): Segment => ({ id: typeof row.id === 'string' ? row.id : fallbackId, title: typeof row.title === 'string' ? row.title.trim() : '', startedAt: typeof row.started_at === 'number' ? row.started_at : 0 });

/** The open session's earlier segments (through `parent_session_id`) and later ones (Hermes's `latest-descendant` path). */
export async function readLineage(rest: (path: string) => Promise<unknown>, { storedId, profile }: { storedId: string; profile: string }): Promise<Lineage> {
  const scope = `?profile=${encodeURIComponent(profile)}`;
  const row = (id: string) => rest(`/api/sessions/${encodeURIComponent(id)}${scope}`) as Promise<Row>;
  const current = await row(storedId);
  const before: Segment[] = [];
  let child = current;
  for (let step = 0; step < MAX_SEGMENTS; step++) {
    const parentId = typeof child.parent_session_id === 'string' ? child.parent_session_id : '';
    if (parentId === '') break;
    const parent = await row(parentId).catch(() => undefined);
    const continued = parent !== undefined && parent.end_reason === 'compression' && typeof parent.ended_at === 'number' && typeof child.started_at === 'number' && child.started_at >= parent.ended_at;
    if (!parent || !continued) break;
    before.unshift(segmentOf(parent, parentId));
    child = parent;
  }
  const forward = (await rest(`/api/sessions/${encodeURIComponent(storedId)}/latest-descendant${scope}`).catch(() => undefined)) as { path?: unknown } | undefined;
  const later = Array.isArray(forward?.path) ? (forward.path as unknown[]).filter((id): id is string => typeof id === 'string' && id !== storedId).slice(0, MAX_SEGMENTS) : [];
  const after = await Promise.all(later.map(async (id) => segmentOf((await row(id).catch(() => ({}))) as Row, id)));
  return { segments: [...before, segmentOf(current, storedId), ...after], index: before.length };
}
