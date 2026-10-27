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

/**
 * The chat runs that finished (the activity feed, newest first), one item for each chat: its latest finish. A run with no stored chat has nothing to open.
 * Today shows every profile, so a run's address names the profile that ran it: without it Talk would open the session in the tab's profile, the wrong agent.
 */
export function runCandidates(events: readonly ActivityEvent[]): ReadyItem[] {
  const items = new Map<string, ReadyItem>();
  for (const event of events) {
    if (event.storedSessionId === undefined) continue;
    const id = `run:${event.storedSessionId}`;
    const known = items.get(id);
    if (known && known.at >= event.at) continue;
    const where = event.profile === undefined ? '' : `?${new URLSearchParams({ profile: event.profile })}`;
    items.set(id, { id, stamp: String(event.seq), kind: 'run', title: event.title, summary: undefined, profile: event.profile, at: event.at, to: `/chat/${encodeURIComponent(event.storedSessionId)}${where}` });
  }
  return [...items.values()];
}

/** Hermes's name for a scheduled job's run (`cron_<job id>_<YYYYmmdd>_<HHMMSS>`, `cron/scheduler.py`): the job is everything between the prefix and the time. */
const CRON_RUN = /^cron_(.+)_\d{8}_\d{6}$/;

/**
 * The scheduled jobs' runs that finished, from Hermes's session list of the `cron` source (any order), one item for each job: its latest finished run. A run is
 * finished when Hermes closed it with `cron_complete`; one that failed is a notice, and one still going is not done. The item is a run like a chat's, so opening
 * its session in Talk is what takes it off the list, and a job's next run is new work. A script job starts no agent and leaves no session, so it is not here.
 */
export function automationCandidates(rows: readonly unknown[]): ReadyItem[] {
  const latest = new Map<string, ReadyItem>();
  for (const row of rows) {
    if (!isRecord(row) || row.source !== 'cron' || row.end_reason !== 'cron_complete') continue;
    const session = text(row.id);
    const ended = typeof row.ended_at === 'number' && Number.isFinite(row.ended_at) ? row.ended_at : undefined;
    if (session === undefined || ended === undefined) continue;
    const job = CRON_RUN.exec(session)?.[1] ?? session;
    const profile = text(row.profile);
    const key = `${profile ?? ''}:${job}`;
    const known = latest.get(key);
    if (known && Number(known.stamp) >= ended) continue;
    const where = profile === undefined ? '' : `?${new URLSearchParams({ profile })}`;
    latest.set(key, { id: `run:${session}`, stamp: String(ended), kind: 'run', title: text(row.title) ?? 'A scheduled job', summary: 'Scheduled job ran', profile, at: Math.round(ended * 1000), to: `/chat/${encodeURIComponent(session)}${where}` });
  }
  return [...latest.values()];
}
