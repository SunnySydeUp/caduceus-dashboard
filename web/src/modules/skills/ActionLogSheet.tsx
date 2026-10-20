// The live log of one of Hermes's background actions (an install, Update all, a curator review): a full-screen sheet on a phone, a dialog
// elsewhere. Hermes runs these as processes of its own and keeps their output in a log it serves; it sends no event when one ends, so
// the sheet looks at the log every 400 ms until the process has finished. Closing the sheet does not stop Hermes.
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../icons.tsx';
import { Sheet } from '../../overlays/Sheet.tsx';
import { fetchActionLog } from './hub-data.ts';
import type { ActionLog } from './hub-model.ts';
import './skills.css';

/** What a finished action turns out to have done: Hermes's exit code is not always the answer, so the screen that started it judges. */
export type LogVerdict = { ok: true; message?: string } | { ok: false; message: string };

export interface LogRun {
  /** The name of Hermes's action, whose log to follow. */
  action: string;
  title: string;
  /** The toast's words when it ends well. */
  doneTitle: string;
  /** Says how it went once the process has finished, from its log. */
  judge(log: ActionLog): Promise<LogVerdict>;
}

const LOOK_MS = 400;
/** About ten minutes: a download over a slow line. After that the sheet says Hermes is still at it. */
const MAX_LOOKS = 1500;
/** Looks that fail in a row before the sheet says Hermes does not answer. */
const MISSES_BEFORE_NOTE = 5;

type Phase = { state: 'running' } | { state: 'ended'; verdict: LogVerdict } | { state: 'long' };

export function ActionLogSheet({ run, onFinished, onClose }: { run: LogRun; onFinished(verdict: LogVerdict): void; onClose(): void }) {
  const [lines, setLines] = useState<string[]>([]);
  const [phase, setPhase] = useState<Phase>({ state: 'running' });
  const [silent, setSilent] = useState(false);
  const log = useRef<HTMLPreElement>(null);
  const finished = useRef(onFinished);
  finished.current = onFinished;

  useEffect(() => {
    let current = true;
    void (async () => {
      let misses = 0;
      for (let look = 0; look < MAX_LOOKS; look++) {
        try {
          const seen = await fetchActionLog(run.action);
          if (!current) return;
          misses = 0;
          setSilent(false);
          setLines(seen.lines);
          if (!seen.running) {
            const verdict = await run.judge(seen);
            if (!current) return;
            setPhase({ state: 'ended', verdict });
            finished.current(verdict);
            return;
          }
        } catch {
          if (!current) return;
          if (++misses >= MISSES_BEFORE_NOTE) setSilent(true);
        }
        const pause = Promise.withResolvers<void>();
        window.setTimeout(pause.resolve, LOOK_MS);
        await pause.promise;
        if (!current) return;
      }
      if (current) setPhase({ state: 'long' });
    })();
    return () => {
      current = false;
    };
    // One sheet follows one action: `run` is rebuilt at every render of the screen that holds it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.action]);

  // The newest line stays in view while the log grows.
  useEffect(() => {
    const element = log.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [lines]);

  const shown = lines.filter((line, index) => line.trim() !== '' || (index > 0 && index < lines.length - 1));
  return (
    <Sheet
      title={run.title}
      detents={['full']}
      className="sk-log-sheet"
      onClose={onClose}
      footer={
        <button type="button" className="btn btn--secondary" onClick={onClose}>
          {phase.state === 'running' ? 'Close, Hermes keeps going' : 'Close'}
        </button>
      }
    >
      <p className="sk-log-state" role="status">
        {phase.state === 'running' && (
          <>
            <Icon name="running" small /> Hermes is working…
          </>
        )}
        {phase.state === 'ended' && phase.verdict.ok && (
          <>
            <Icon name="succeeded" small /> {phase.verdict.message ?? 'Finished.'}
          </>
        )}
        {phase.state === 'ended' && !phase.verdict.ok && (
          <span className="sk-error">
            <Icon name="failed" small /> {phase.verdict.message}
          </span>
        )}
        {phase.state === 'long' && 'Hermes is still working. Close this: the log stays in Hermes, and the list shows the result when it is done.'}
      </p>
      {silent && phase.state === 'running' && (
        <p className="sk-error" role="alert">
          <Icon name="alert" small /> Hermes is not answering, so the log is not updating. Caduceus keeps trying.
        </p>
      )}
      <pre ref={log} className="sk-log" role="log" aria-label={`Log of ${run.title}`} tabIndex={0}>
        {shown.length > 0 ? shown.join('\n') : 'Waiting for Hermes’s first line…'}
      </pre>
    </Sheet>
  );
}
