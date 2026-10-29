// The live output of one diagnostic action: a full-screen sheet on a phone, a dialog elsewhere. Closing it does not stop Hermes.
import { useEffect, useRef } from 'react';
import { Icon } from '../../icons.tsx';
import { Sheet } from '../../overlays/Sheet.tsx';
import { useActionOutput } from './diagnostics-data.ts';
import { endWords, type DiagnosticAction } from './diagnostics-model.ts';
import './maintenance.css';

export function ActionOutputSheet({ action, run, onClose }: { action: DiagnosticAction; run: number; onClose(): void }) {
  const output = useActionOutput(action.id, run);
  const log = useRef<HTMLPreElement>(null);
  const ending = endWords(output);
  // The newest line stays in view while the output grows.
  useEffect(() => {
    const element = log.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [output.lines]);
  return (
    <Sheet
      title={action.label}
      detents={['full']}
      className="mt-log-sheet"
      onClose={onClose}
      footer={
        <button type="button" className="btn btn--secondary" onClick={onClose}>
          {output.status === 'running' ? 'Close, Hermes keeps going' : 'Close'}
        </button>
      }
    >
      <p className="mt-log-state" role="status">
        {output.status === 'running' && (
          <>
            <Icon name="running" small /> Hermes is working…
          </>
        )}
        {ending && (
          <span className={ending.tone === 'success' ? undefined : ending.tone === 'warning' ? 'mt-warn' : 'mt-error'}>
            <Icon name={ending.tone === 'success' ? 'succeeded' : ending.tone === 'warning' ? 'alert' : 'failed'} small /> {ending.text}
          </span>
        )}
        {output.status === 'lost' && (
          <span className="mt-error">
            <Icon name="alert" small /> Caduceus lost the connection to the output. Hermes may still be working: run it again to read what it printed.
          </span>
        )}
      </p>
      <pre ref={log} className="mt-log" role="log" aria-label={`Output of ${action.label}`} tabIndex={0}>
        {output.lines.length > 0 ? output.lines.join('\n') : 'Waiting for the first line…'}
      </pre>
    </Sheet>
  );
}
