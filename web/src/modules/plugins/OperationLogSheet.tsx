// The live log of one install or update: a full-screen sheet on a phone, a dialog elsewhere. Hermes's command prints as it works and Caduceus
// relays each line (`plugins-log.ts`); the sheet ends with a clear success or failure in Hermes's own words. Closing the sheet does not stop Hermes.
import { useEffect, useRef } from 'react';
import { Icon } from '../../icons.tsx';
import { Sheet } from '../../overlays/Sheet.tsx';
import { useOperationLog } from './plugins-log.ts';
import type { OperationState } from './plugins-model.ts';
import './plugins.css';

export function OperationLogSheet({ id, title, onFinished, onClose }: { id: string; title: string; onFinished(state: OperationState): void; onClose(): void }) {
  const state = useOperationLog(id);
  const log = useRef<HTMLPreElement>(null);
  const finished = useRef(onFinished);
  finished.current = onFinished;

  // The newest line stays in view while the log grows.
  useEffect(() => {
    const element = log.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [state.lines]);
  // The screen that started the operation is told once, when it has ended one way or the other.
  useEffect(() => {
    if (state.status !== 'running') finished.current(state);
  }, [state]);

  const shown = state.lines.filter((line, index) => line.trim() !== '' || (index > 0 && index < state.lines.length - 1));
  return (
    <Sheet
      title={title}
      detents={['full']}
      className="pl-log-sheet"
      onClose={onClose}
      footer={
        <button type="button" className="btn btn--secondary" onClick={onClose}>
          {state.status === 'running' ? 'Close, Hermes keeps going' : 'Close'}
        </button>
      }
    >
      <p className="pl-log-state" role="status">
        {state.status === 'running' && (
          <>
            <Icon name="running" small /> Hermes is working…
          </>
        )}
        {state.status === 'ok' && (
          <>
            <Icon name="succeeded" small /> {state.message}
          </>
        )}
        {state.status === 'failed' && (
          <span className="pl-error">
            <Icon name="failed" small /> {state.message}
          </span>
        )}
        {state.status === 'lost' && (
          <span className="pl-error">
            <Icon name="alert" small /> {state.message}
          </span>
        )}
      </p>
      <pre ref={log} className="pl-log" role="log" aria-label={`Log of ${title}`} tabIndex={0}>
        {shown.length > 0 ? shown.join('\n') : 'Waiting for Hermes’s first line…'}
      </pre>
    </Sheet>
  );
}
