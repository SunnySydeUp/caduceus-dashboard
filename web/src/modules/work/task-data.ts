// Reading one task for its page: the detail over REST, kept live by the Kanban events socket. Only GETs live here; every change goes
// through `task-actions.ts`. Nothing is kept beyond what the page shows (D1).
import { useEffect, useRef, useState } from 'react';
import { createLiveTask, type LiveTask, type LiveTaskState } from './task-live.ts';
import { parseTaskDetail, type TaskDetail } from './task-model.ts';

const KANBAN = '/api/plugins/kanban';

const boardQuery = (slug: string | undefined) => (slug ? `?board=${encodeURIComponent(slug)}` : '');

/** The task `taskId` of the board `slug` (the current one when `undefined`), loaded and then followed. It is read again when the tab returns to the foreground or the network comes back. */
export function useLiveTask(taskId: string, slug: string | undefined): { state: LiveTaskState; reload(): void } {
  const [state, setState] = useState<LiveTaskState>({ phase: 'loading', live: false });
  const engine = useRef<LiveTask>(undefined);
  useEffect(() => {
    setState({ phase: 'loading', live: false });
    const live = createLiveTask({
      fetchTask: async () => {
        const response = await fetch(`${KANBAN}/tasks/${encodeURIComponent(taskId)}${boardQuery(slug)}`);
        if (!response.ok) throw new Error(`Hermes answered HTTP ${response.status}`);
        return response.json();
      },
      openEvents: async (since) => new WebSocket(`${location.origin.replace(/^http/, 'ws')}${KANBAN}/events?${[slug ? `board=${encodeURIComponent(slug)}` : '', `since=${since}`].filter(Boolean).join('&')}`),
    });
    engine.current = live;
    const stop = live.subscribe(() => setState(live.state));
    const resume = () => {
      if (document.visibilityState === 'visible') live.resume();
    };
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('online', resume);
    window.addEventListener('pageshow', resume);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('online', resume);
      window.removeEventListener('pageshow', resume);
      live.close();
    };
  }, [taskId, slug]);
  return { state, reload: () => engine.current?.resume() };
}

/** The profiles a task can be given to: Hermes's profiles on disk and everyone who already has a task on the board. Empty when Hermes does not answer. */
export async function loadAssignees(slug: string | undefined): Promise<string[]> {
  try {
    const response = await fetch(`${KANBAN}/assignees${boardQuery(slug)}`);
    if (!response.ok) return [];
    const body: { assignees?: { name?: unknown }[] } = await response.json();
    return (body.assignees ?? []).flatMap((entry) => (typeof entry.name === 'string' ? [entry.name] : []));
  } catch {
    return [];
  }
}

/** The text of an attachment, for the preview of text files (the first `limit` characters; `truncated` says there was more). */
export async function loadAttachmentText(url: string, limit: number): Promise<{ text: string; truncated: boolean }> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Hermes answered HTTP ${response.status}`);
  const text = await response.text();
  return { text: text.slice(0, limit), truncated: text.length > limit };
}

/** The task as Hermes has it now, read once (not followed): what the page compares with after an AI assist wrote to it. */
export async function readTask(taskId: string, slug: string | undefined): Promise<TaskDetail> {
  const response = await fetch(`${KANBAN}/tasks/${encodeURIComponent(taskId)}${boardQuery(slug)}`);
  if (!response.ok) throw new Error(`Hermes answered HTTP ${response.status}`);
  return parseTaskDetail(await response.json());
}
