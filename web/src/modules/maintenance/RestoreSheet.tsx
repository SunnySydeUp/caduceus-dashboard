// The restore as it goes: a full-screen sheet on a phone, a dialog elsewhere. It shows the steps (pause, restore, restart, check), Hermes's log of the import as it
// grows, and, once Caduceus is back, what the contract check says about the restored Hermes. Closing the sheet does not stop the restore.
import { useEffect, useRef, useState } from 'react';
import type { CompatibilityReport } from '@caduceus/contracts/caduceus-api';
import { Icon } from '../../icons.tsx';
import { Sheet } from '../../overlays/Sheet.tsx';
import { AppLink } from '../../shell/navigation.tsx';
import { waitForContractCheck, waitForRestart } from './backup-data.ts';
import { restoreSteps, restoreVerdict, type RestorePhase } from './backup-model.ts';
import { useActionOutput } from './diagnostics-data.ts';
import './maintenance.css';

const STEP_ICON = { done: 'succeeded', current: 'running', failed: 'failed', todo: 'queued' } as const;

type After = { phase: 'restarting' } | { phase: 'checked'; report?: CompatibilityReport } | { phase: 'lost' };

export function RestoreSheet({ onFinished, onClose }: { onFinished(): void; onClose(): void }) {
  const output = useActionOutput('import', 0);
  const [after, setAfter] = useState<After>();
  const log = useRef<HTMLPreElement>(null);
  const finished = useRef(onFinished);
  finished.current = onFinished;

  useEffect(() => {
    const element = log.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [output.lines]);

  // Hermes finished the import: Caduceus now restarts Hermes and itself. This page waits for it to be back, then reads the contract check of the restored Hermes.
  useEffect(() => {
    if (output.status !== 'ok') return;
    let live = true;
    setAfter({ phase: 'restarting' });
    void (async () => {
      const back = await waitForRestart();
      if (!live) return;
      if (!back) return setAfter({ phase: 'lost' });
      const report = await waitForContractCheck();
      if (!live) return;
      setAfter({ phase: 'checked', report });
      finished.current();
    })();
    return () => {
      live = false;
    };
  }, [output.status]);

  const phase: RestorePhase = after?.phase === 'checked' ? 'checked' : after?.phase === 'restarting' || after?.phase === 'lost' ? 'restarting' : 'importing';
  const status = output.status === 'failed' || output.status === 'lost' || after?.phase === 'lost' ? 'failed' : after?.phase === 'checked' ? 'ok' : 'running';
  const steps = restoreSteps(phase, status);
  const verdict = after?.phase === 'checked' ? restoreVerdict(after.report) : undefined;
  return (
    <Sheet
      title="Restore a backup"
      detents={['full']}
      className="mt-log-sheet"
      onClose={onClose}
      footer={
        <button type="button" className="btn btn--secondary" onClick={onClose}>
          {status === 'running' ? 'Close, the restore keeps going' : 'Close'}
        </button>
      }
    >
      <ol className="mt-steps" aria-label="Steps of the restore">
        {steps.map((step) => (
          <li key={step.phase} data-state={step.state} aria-current={step.state === 'current' ? 'step' : undefined}>
            <Icon name={STEP_ICON[step.state]} small />
            <span>{step.label}</span>
          </li>
        ))}
      </ol>
      <p className="mt-log-state" role="status">
        {status === 'running' && after === undefined && (
          <>
            <Icon name="running" small /> Hermes is restoring the backup…
          </>
        )}
        {status === 'running' && after?.phase === 'restarting' && (
          <>
            <Icon name="running" small /> Restored. Caduceus is restarting Hermes and itself; this page reconnects by itself.
          </>
        )}
        {verdict && (
          <span className={verdict.tone === 'warning' ? 'mt-error' : undefined}>
            <Icon name={verdict.tone === 'warning' ? 'alert' : 'succeeded'} small /> Restored. {verdict.text}{' '}
            <AppLink to="/observe/health">Open Health</AppLink>
          </span>
        )}
        {output.status === 'failed' && (
          <span className="mt-error">
            <Icon name="failed" small /> Hermes ended with an error{output.exitCode === null ? '' : ` (exit code ${output.exitCode})`}. Nothing was restarted, and new turns are allowed again.
          </span>
        )}
        {output.status === 'lost' && (
          <span className="mt-error">
            <Icon name="alert" small /> Caduceus lost the connection to the log. The restore may still be running: look at Health in a moment.
          </span>
        )}
        {after?.phase === 'lost' && (
          <span className="mt-error">
            <Icon name="alert" small /> Caduceus did not come back in three minutes. Check that its background service is running on the Mac.
          </span>
        )}
      </p>
      <pre ref={log} className="mt-log" role="log" aria-label="Log of the restore" tabIndex={0}>
        {output.lines.length > 0 ? output.lines.join('\n') : 'Waiting for the first line…'}
      </pre>
    </Sheet>
  );
}
