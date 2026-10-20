import { useEffect, useState } from 'react';
import { afterPaint, settled } from './settled.ts';

function useAfter(wait: () => Promise<void>): boolean {
  const [done, setDone] = useState(false);
  useEffect(() => {
    let current = true;
    void wait().then(() => current && setDone(true));
    return () => {
      current = false;
    };
  }, [wait]);
  return done;
}

const untilSettled = () => settled;

/** Whether the first screen is done (`settled.ts`): what sits below it waits for this before it loads, so that what is on the first screen is not queued behind it. */
export function useSettled(): boolean {
  return useAfter(untilSettled);
}

/** Whether the first screen has been painted (`afterPaint` in `settled.ts`): what is only recorded, or shown below the first screen, waits for this so that its request is not in front of the paint. */
export function usePainted(): boolean {
  return useAfter(afterPaint);
}
