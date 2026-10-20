// What "ready for review" and "while you were away" mean (M8 #03), as pure functions: which finished work is offered, and what a visit to Today is.
// Ready for review is work that is DONE and has NOT BEEN OPENED SINCE it finished. Hermes knows what finished; it has no notion of opened. That one fact is
// Caduceus's own, kept as a marker (the id and the stamp of the finish that was opened), never as a copy of the task or the run.
import { isRecord } from '@caduceus/contracts/policy/guards';
import type { ActivityEvent } from '@caduceus/contracts/inbox';
import type { ReadyItem, TodayVisit } from '@caduceus/contracts/today';

/** How far back finished work is offered: older work that was never opened is no longer news. */
export const READY_WINDOW_MS = 14 * 24 * 3_600_000;

/** How long a pause between two opens of Today makes the second one a new visit; opening Today again sooner (a reload, a tap back) is the same visit. */
export const AWAY_GAP_MS = 15 * 60_000;

/** How long an opened marker is kept: past the ready window an item can no longer be offered, so its marker has nothing left to say. */
export const MARKER_KEPT_MS = 2 * READY_WINDOW_MS;

/** The owner's place: when Caduceus began keeping it, and the visits. */
export interface VisitState {
  visitAt: number | undefined;
  previousVisitAt: number | undefined;
}

/**
 * What a visit at `now` is. The first visit has nothing before it. A visit that comes within `AWAY_GAP_MS` of the last one goes on the same stretch (what came before
 * the stretch is still "since"); one that comes later starts a new stretch, and the last visit is what the owner was away since.
 */
export function recordVisit(state: VisitState, now: number): { state: VisitState; visit: TodayVisit } {
  const continuing = state.visitAt !== undefined && now - state.visitAt < AWAY_GAP_MS;
  const previousVisitAt = continuing ? state.previousVisitAt : state.visitAt;
  return { state: { visitAt: now, previousVisitAt }, visit: { since: previousVisitAt ?? null, at: now } };
}

/** One opened marker as the store holds it. */
export interface OpenedMarker {
  id: string;
  stamp: string;
}

/**
 * The items still to review: those that finished inside the window and after Caduceus began (`began`), and that the owner has not opened at the stamp they have now.
 * Newest first. Times are compared by the second, the grain of Hermes's Kanban clock, so a task that finished in the second Caduceus began still counts.
 */
export function readyItems(candidates: readonly ReadyItem[], opened: readonly OpenedMarker[], { began, now }: { began: number; now: number }): ReadyItem[] {
  const from = Math.max(Math.floor(began / 1000) * 1000, now - READY_WINDOW_MS);
  const seen = new Map(opened.map(({ id, stamp }) => [id, stamp]));
  return candidates.filter((item) => item.at >= from && seen.get(item.id) !== item.stamp).sort((a, b) => b.at - a.at);
}

const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() !== '' ? value : undefined);

/** One board as Hermes answers `GET /board`: its slug and its tasks, each with the column's name as `status`. */
export interface BoardTasks {
  slug: string;
  tasks: unknown[];
}

/** The tasks that reached Done, as items. Hermes stamps a finish with `completed_at` (seconds), and a task done a second time has a later one. */
export function taskCandidates(boards: readonly BoardTasks[]): ReadyItem[] {
  return boards.flatMap(({ slug, tasks }) =>
    tasks.flatMap((task): ReadyItem[] => {
      if (!isRecord(task) || task.status !== 'done') return [];
      const id = text(task.id);
      const title = text(task.title);
      const completed = typeof task.completed_at === 'number' && Number.isFinite(task.completed_at) ? task.completed_at : undefined;
      if (id === undefined || title === undefined || completed === undefined) return [];
      const summary = text(task.latest_summary) ?? text(task.result);
      return [
        {
          id: `task:${slug}:${id}`,
          stamp: String(completed),
          kind: 'task',
          title,
          summary: summary === undefined || summary === title ? undefined : summary.slice(0, 400),
          profile: text(task.assignee),
          at: Math.round(completed * 1000),
          to: `/work/tasks/${encodeURIComponent(id)}?board=${encodeURIComponent(slug)}`,
        },
      ];
    }),
  );
}

/** The chat runs that finished (the activity feed, newest first), one item for each chat: its latest finish. A run with no stored chat has nothing to open. */
export function runCandidates(events: readonly ActivityEvent[]): ReadyItem[] {
  const items = new Map<string, ReadyItem>();
  for (const event of events) {
    if (event.storedSessionId === undefined) continue;
    const id = `run:${event.storedSessionId}`;
    const known = items.get(id);
    if (known && known.at >= event.at) continue;
    items.set(id, { id, stamp: String(event.seq), kind: 'run', title: event.title, summary: undefined, profile: event.profile, at: event.at, to: `/chat/${encodeURIComponent(event.storedSessionId)}` });
  }
  return [...items.values()];
}
