import { useEffect } from 'react';
import { useInbox } from '../inbox/inbox-feed.ts';
import { readReady } from '../today/today-data.ts';
import { markOpened } from '../today/ready-feed.ts';
import { finishSeqIn, readyToOpen } from './talk-review.ts';

/**
 * Opening a session in Talk is looking at it: when the run that finished in it is waiting in Today's "Ready for review", tell Caduceus it was opened so that it leaves the
 * list (`talk-review.ts` decides). A run that finishes while the chat is already open is looked at as it ends, so each new finish of the open session asks again. If Caduceus
 * does not answer the run stays ready, which is the safe way to be wrong.
 */
export function useReviewOpened(storedId: string | undefined): void {
  const finish = finishSeqIn(storedId, useInbox().activity);
  useEffect(() => {
    if (storedId === undefined) return;
    let current = true;
    readReady().then(
      (items) => {
        const opened = readyToOpen(storedId, items);
        if (current && opened) void markOpened(opened);
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [storedId, finish]);
}
