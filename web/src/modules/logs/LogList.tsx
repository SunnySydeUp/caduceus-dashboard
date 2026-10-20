import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { jumpToLatest, layoutOf, scrolled, visibleWindow, type FollowState } from '../chat/virtual-list.ts';
import { levelOfLine, splitMatches, type LogRow } from './logs-model.ts';

/** A line of one row of text; lines that wrap are measured once they are on screen. */
const ROW_ESTIMATE = 22;
const OVERSCAN = 10;

/**
 * The lines of a log, virtualised: only the lines in view (and a few either side) are in the page, whatever the log's length, and the
 * space of the rest stands in as padding. It sticks to the end while the reader is there (`onFollowing` says whether they are), and a
 * change of `jump` takes the reader back to the end. A line is picked by its number, which is a button, so nothing needs a gesture.
 */
export function LogList({ rows, search, picked, onPick, jump, onFollowing }: { rows: LogRow[]; search: string; picked: ReadonlySet<number>; onPick(id: number): void; jump: number; onFollowing(following: boolean): void }) {
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const heights = useRef(new Map<number, number>());
  const follow = useRef<FollowState>({ following: true, lastTop: 0 });
  const observer = useRef<ResizeObserver>(undefined);
  const [scroll, setScroll] = useState({ top: 0, height: 0 });
  const [version, setVersion] = useState(0);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` stands for the heights that were measured
  const layout = useMemo(() => layoutOf(rows.map((row) => heights.current.get(row.id)), ROW_ESTIMATE, 0), [rows, version]);
  const shown = visibleWindow({ layout, scrollTop: scroll.top, viewport: scroll.height, overscan: OVERSCAN });

  const stay = () => {
    const element = scroller.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
    follow.current = { following: true, lastTop: element.scrollTop };
    setScroll({ top: element.scrollTop, height: element.clientHeight });
  };

  // Measure what is on screen: lines wrap, and the window's width changes.
  useEffect(() => {
    let frame = 0;
    const measured = new ResizeObserver((entries) => {
      let changed = false;
      for (const entry of entries) {
        const id = Number((entry.target as HTMLElement).dataset.id);
        const height = Math.ceil(entry.borderBoxSize?.[0]?.blockSize ?? (entry.target as HTMLElement).offsetHeight);
        if (Number.isFinite(id) && heights.current.get(id) !== height) {
          heights.current.set(id, height);
          changed = true;
        }
      }
      if (changed && frame === 0) frame = requestAnimationFrame(() => ((frame = 0), setVersion((n) => n + 1)));
    });
    observer.current = measured;
    const element = scroller.current;
    const resized = new ResizeObserver(() => element && setScroll({ top: element.scrollTop, height: element.clientHeight }));
    if (element) resized.observe(element);
    return () => {
      measured.disconnect();
      resized.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);
  useEffect(() => {
    for (const element of content.current?.children ?? []) observer.current?.observe(element);
  });
  // Lines that have left the screen for good (the log was cleared, or aged out of the last 5,000) are forgotten.
  useEffect(() => {
    if (heights.current.size <= rows.length * 2 + 200) return;
    const alive = new Set(rows.map((row) => row.id));
    for (const id of heights.current.keys()) if (!alive.has(id)) heights.current.delete(id);
  }, [rows]);

  // After every change of lines or heights: stay at the end, if that is where the reader is.
  useLayoutEffect(() => {
    if (follow.current.following) stay();
  }, [layout]);
  useEffect(() => {
    if (jump > 0) {
      stay();
      onFollowing(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new request to jump moves the reader
  }, [jump]);

  const onScroll = () => {
    const element = scroller.current;
    if (!element) return;
    const next = scrolled(follow.current, { scrollTop: element.scrollTop, viewport: element.clientHeight, total: element.scrollHeight });
    if (next.following !== follow.current.following) onFollowing(next.following);
    follow.current = next;
    setScroll({ top: element.scrollTop, height: element.clientHeight });
  };

  return (
    <div ref={scroller} className="lg-scroll" role="log" aria-live="off" aria-label="Log lines" tabIndex={0} onScroll={onScroll}>
      <div ref={content} className="lg-lines" style={{ paddingBlockStart: shown.before, paddingBlockEnd: shown.after }}>
        {rows.slice(shown.start, shown.end).map((row, offset) => {
          const number = shown.start + offset + 1;
          const isPicked = picked.has(row.id);
          return (
            <div key={row.id} data-id={row.id} className="lg-row" data-level={levelOfLine(row.text)} data-picked={isPicked || undefined}>
              <button type="button" className="lg-pick" aria-pressed={isPicked} aria-label={`Select line ${number}`} onClick={() => onPick(row.id)}>
                {number}
              </button>
              <span className="lg-text">
                {splitMatches(row.text, search).map((part, index) => (part.match ? <mark key={index}>{part.text}</mark> : part.text))}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
