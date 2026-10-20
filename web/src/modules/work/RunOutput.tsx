// What a run produced. A short output is one block of text. A long one (a script's log can be tens of thousands of lines) shows only the
// lines near the screen, in a box that scrolls: every line has the same height, which the stylesheet fixes and this measures, so the
// lines that are not drawn are stood in for by two spacers of the right size (`rowWindow`, constant time).
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { rowWindow, type RowWindow } from './tasks-model.ts';

/** More lines than this are drawn by window. */
export const WHOLE_BELOW_LINES = 200;
const ESTIMATED_LINE = 22;
const OVERSCAN = 20;

/** The lines of the window between two spacers that stand in for the lines left out. */
export function OutputLines({ lines, shown }: { lines: readonly string[]; shown: RowWindow }) {
  return (
    <>
      {shown.before > 0 && <div className="jlog__spacer" aria-hidden="true" style={{ blockSize: shown.before }} />}
      {lines.slice(shown.start, shown.end).map((line, offset) => (
        <div key={shown.start + offset} className="jlog__line" data-line={shown.start + offset + 1}>
          {line === '' ? ' ' : line}
        </div>
      ))}
      {shown.after > 0 && <div className="jlog__spacer" aria-hidden="true" style={{ blockSize: shown.after }} />}
    </>
  );
}

function WindowedOutput({ lines }: { lines: readonly string[] }) {
  const box = useRef<HTMLDivElement>(null);
  const [lineHeight, setLineHeight] = useState(ESTIMATED_LINE);
  const [place, setPlace] = useState({ scrollTop: 0, viewport: 400 });

  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    const update = () => setPlace((previous) => (previous.scrollTop === element.scrollTop && previous.viewport === element.clientHeight ? previous : { scrollTop: element.scrollTop, viewport: element.clientHeight }));
    update();
    element.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => {
      element.removeEventListener('scroll', update);
      observer.disconnect();
    };
  }, []);
  // The first line, as it is: its height is the stride of every line.
  useLayoutEffect(() => {
    const line = box.current?.querySelector<HTMLElement>('.jlog__line');
    if (line && Math.abs(line.getBoundingClientRect().height - lineHeight) > 0.5) setLineHeight(line.getBoundingClientRect().height);
  });

  const shown = useMemo(() => rowWindow({ count: lines.length, rowHeight: lineHeight, scrollTop: place.scrollTop, viewport: place.viewport, overscan: OVERSCAN }), [lines.length, lineHeight, place]);
  return (
    <>
      <p className="subtle jlog__note">
        {lines.length.toLocaleString()} lines. Scroll inside the box to read them; only the lines near the screen are drawn.
      </p>
      <div className="jlog" ref={box} role="region" aria-label={`Output, ${lines.length.toLocaleString()} lines`} tabIndex={0}>
        <OutputLines lines={lines} shown={shown} />
      </div>
    </>
  );
}

/** The output of a run: `truncated` says Hermes read only the start of a very long file. */
export function RunOutput({ text, truncated = false }: { text: string; truncated?: boolean }) {
  const lines = useMemo(() => text.split('\n'), [text]);
  return (
    <div className="jrun__out">
      {lines.length > WHOLE_BELOW_LINES ? (
        <WindowedOutput lines={lines} />
      ) : (
        <pre className="log" tabIndex={0} aria-label="Output">
          {text}
        </pre>
      )}
      {truncated && <p className="subtle">Hermes sent only the start of this output, because it is very long.</p>}
    </div>
  );
}
