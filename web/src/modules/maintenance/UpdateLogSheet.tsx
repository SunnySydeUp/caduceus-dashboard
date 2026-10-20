// The live log of one update: a full-screen sheet on a phone, a dialog elsewhere. It shows the steps (pause, update, restart, check, resume), the log as
// it grows, and, when the update ended well, What's New for it. Closing the sheet does not stop the update.
import { useEffect, useRef, useState } from 'react';
import type { UpdateTarget, WhatsNewEntry } from '@caduceus/contracts/caduceus-api';
import { Icon } from '../../icons.tsx';
import { Sheet } from '../../overlays/Sheet.tsx';
import { fetchUpdatesState } from '../../updates.ts';
import { useUpdateLog } from './updates-log.ts';
import { phaseSteps } from './updates-model.ts';
import { ChangeList } from './WhatsNew.tsx';
import './maintenance.css';

const STEP_ICON = { done: 'succeeded', current: 'running', failed: 'failed', todo: 'queued' } as const;

export function UpdateLogSheet({ id, target, onFinished, onClose }: { id: string; target: UpdateTarget; onFinished(): void; onClose(): void }) {
  const state = useUpdateLog(id);
  const log = useRef<HTMLPreElement>(null);
  const finished = useRef(onFinished);
  finished.current = onFinished;
  const [entry, setEntry] = useState<WhatsNewEntry>();
  const name = target === 'hermes' ? 'Hermes' : 'Caduceus';

  // The newest line stays in view while the log grows.
  useEffect(() => {
    const element = log.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [state.lines]);
  // Once it has ended, the screen reads what it changed, and What's New for it is shown here too.
  useEffect(() => {
    if (state.status === 'running') return;
    finished.current();
    void fetchUpdatesState().then((current) => setEntry(current?.history.find((candidate) => candidate.id === id)));
  }, [state.status, id]);

  const steps = phaseSteps(target, state.phase, state.status);
  return (
    <Sheet
      title={`Update ${name}`}
      detents={['full']}
      className="mt-log-sheet"
      onClose={onClose}
      footer={
        <button type="button" className="btn btn--secondary" onClick={onClose}>
          {state.status === 'running' ? 'Close, the update keeps going' : 'Close'}
        </button>
      }
    >
      <ol className="mt-steps" aria-label="Steps of the update">
        {steps.map((step) => (
          <li key={step.phase} data-state={step.state} aria-current={step.state === 'current' ? 'step' : undefined}>
            <Icon name={STEP_ICON[step.state]} small />
            <span>{step.label}</span>
          </li>
        ))}
      </ol>
      <p className="mt-log-state" role="status">
        {state.status === 'running' && (
          <>
            <Icon name="running" small /> Working…
          </>
        )}
        {state.status === 'ok' && (
          <>
            <Icon name="succeeded" small /> {state.message}
          </>
        )}
        {(state.status === 'failed' || state.status === 'lost') && (
          <span className="mt-error">
            <Icon name={state.status === 'failed' ? 'failed' : 'alert'} small /> {state.message}
          </span>
        )}
        {state.status === 'ok' && target === 'caduceus' && <span> This page reconnects by itself once Caduceus is back.</span>}
      </p>
      <pre ref={log} className="mt-log" role="log" aria-label={`Log of the ${name} update`} tabIndex={0}>
        {state.lines.length > 0 ? state.lines.join('\n') : 'Waiting for the first line…'}
      </pre>
      {entry && entry.changes.length > 0 && (
        <section className="mt-news" aria-labelledby="mt-log-news">
          <h3 id="mt-log-news" className="mt-section__title">
            What’s New
          </h3>
          <ChangeList changes={entry.changes} />
        </section>
      )}
    </Sheet>
  );
}
