import { useEffect, useState } from 'react';

/** The page's clock in ms, ticking every `everyMs` while `active`, for a time such as "5 min" that reads from it. It stops when nothing shows a time. */
export function useNow(active: boolean, everyMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [active, everyMs]);
  return now;
}
