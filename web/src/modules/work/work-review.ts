// "Ready for review" as Work's landing view reads it: Today's review state (`GET /_caduceus/api/today/ready`, M8 #03). Hermes says what finished; Caduceus keeps the
// one thing Hermes lacks, which finished work the owner has opened. The list is derived by the server on every ask, so it is asked again whenever something may
// have finished (a Kanban task reached Done, a run ended) and when the tab returns; opening a row tells the server, and the row leaves the list.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReadyItem, ReadyOpened, ReadyState } from '@caduceus/contracts/today';
import { toast } from '../../shell/toasts.ts';
import { useInbox } from '../inbox/inbox-feed.ts';
import { refreshReady } from '../today/ready-feed.ts';
import type { AllBoards } from './work-desk-data.ts';

export interface ReviewState {
  ready: readonly ReadyItem[];
  /** The server did not answer the last ask: `ready`, if any, is from before. */
  failed: boolean;
  /** The server has answered, or failed to, at least once: until then `ready` is empty because nothing was asked yet, not because nothing finished. */
  asked: boolean;
  /** The owner opened this item: Caduceus keeps that, and the list is read again. */
  opened(item: ReadyOpened): Promise<void>;
  reload(): Promise<void>;
}

async function readReady(): Promise<ReadyItem[]> {
  const response = await fetch('/_caduceus/api/today/ready');
  if (!response.ok) throw new Error(`Caduceus answered HTTP ${response.status}`);
  const state: ReadyState = await response.json();
  return state.items;
}

export function useReadyForReview(boards: AllBoards['boards']): ReviewState {
  const { activity } = useInbox();
  const [ready, setReady] = useState<ReadyItem[]>([]);
  const [failed, setFailed] = useState(false);
  const [asked, setAsked] = useState(false);
  /** Which ask is the latest: an answer that arrives late must not replace a newer one. */
  const latest = useRef(0);

  const reload = useCallback(async () => {
    const ask = ++latest.current;
    try {
      const items = await readReady();
      if (ask !== latest.current) return;
      setReady(items);
      setFailed(false);
    } catch {
      if (ask === latest.current) setFailed(true);
    } finally {
      if (ask === latest.current) setAsked(true);
    }
  }, []);

  // What may have finished: the tasks that are done (each with the finish it has) and the newest run the activity feed saw end.
  const finishes = `${activity[0]?.seq ?? 0}|${boards.flatMap(({ slug, tasks }) => tasks.flatMap((task) => (task.status === 'done' ? [`${slug}:${task.id}:${task.completedAt}`] : []))).join(',')}`;
  useEffect(() => void reload(), [reload, finishes]);
  useEffect(() => {
    const back = () => document.visibilityState === 'visible' && void reload();
    document.addEventListener('visibilitychange', back);
    window.addEventListener('online', back);
    return () => {
      document.removeEventListener('visibilitychange', back);
      window.removeEventListener('online', back);
    };
  }, [reload]);

  const opened = useCallback(
    async (item: ReadyOpened) => {
      try {
        const response = await fetch('/_caduceus/api/today/ready/opened', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(item) });
        if (!response.ok) throw new Error(`Caduceus answered HTTP ${response.status}`);
      } catch {
        toast('Could not note that you opened this, so it stays in Ready for review', { tone: 'danger' });
        return;
      }
      await Promise.all([reload(), refreshReady()]);
    },
    [reload],
  );

  return { ready, failed, asked, opened, reload };
}
