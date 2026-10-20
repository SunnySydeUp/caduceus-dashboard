// The parts of the run view (M3 #11): the header's facts, the step list, a step's transcript and the worker log. Each reads what Hermes holds and shows it; none keeps anything.
import { useMemo, useState, useSyncExternalStore } from 'react';
import { Icon } from '../../icons.tsx';
import { Sheet } from '../../overlays/Sheet.tsx';
import { StatusBadge, type StatusState } from '../../shell/StatusBadge.tsx';
import { toast } from '../../shell/toasts.ts';
import { ActivityGroup, formatDuration } from '../chat/ActivityCards.tsx';
import { entriesOf } from '../chat/activity.ts';
import { Rich } from '../chat/Rich.tsx';
import { LogList } from '../logs/LogList.tsx';
import { heldCount, selectedText, type LogBuffer, type LogRow } from '../logs/logs-model.ts';
import type { RunLogState } from './run-data.ts';
import { shownLogLines, type RunDensity, type RunStep, type RunSummary, type StepOutcome, type WorkerProcess } from './run-model.ts';
import '../chat/chat.css';
import '../logs/logs.css';
import './run-view.css';

/** Whether the window is wide enough for the transcript to sit beside the run (1024 px and up) and not over it. */
export function useWide(): boolean {
  const query = '(min-width: 1024px)';
  return useSyncExternalStore(
    (notify) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', notify);
      return () => list.removeEventListener('change', notify);
    },
    () => window.matchMedia(query).matches,
  );
}

export const money = (usd: number) => `$${usd.toFixed(usd < 1 ? 3 : 2)}`;
const megabytes = (bytes: number) => `${Math.round(bytes / (1024 * 1024))} MB`;

export function RunFacts({ summary, process, startedAt, profile }: { summary: RunSummary; process: WorkerProcess | undefined; startedAt: number; profile: string | null }) {
  return (
    <dl className="td-facts td-facts--inline rv-facts">
      <div>
        <dt>Profile</dt>
        <dd>{profile ?? '—'}</dd>
      </div>
      <div>
        <dt>Started</dt>
        <dd>{new Date(startedAt * 1000).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</dd>
      </div>
      <div>
        <dt>{summary.running ? 'Elapsed' : 'Took'}</dt>
        <dd>{formatDuration(summary.elapsedS)}</dd>
      </div>
      <div>
        <dt>Cost</dt>
        <dd>
          {summary.costUsd === null ? (
            <span title="Hermes records a cost for a worker’s session, and the worker may report one. This run has neither yet.">—</span>
          ) : (
            <span title={summary.costFrom === 'session' ? 'What Hermes recorded for the worker’s session.' : 'What the worker reported in the run’s metadata.'}>{money(summary.costUsd)}</span>
          )}
        </dd>
      </div>
      <div>
        <dt>Tokens</dt>
        <dd>{summary.tokens === null ? '—' : summary.tokens.toLocaleString()}</dd>
      </div>
      {process?.alive && (
        <div>
          <dt>Worker</dt>
          <dd>
            {process.pid !== null && <span className="mono">pid {process.pid}</span>}
            {process.cpuPercent !== null && ` · ${Math.round(process.cpuPercent)}% CPU`}
            {process.memoryBytes !== null && ` · ${megabytes(process.memoryBytes)}`}
          </dd>
        </div>
      )}
    </dl>
  );
}

const OUTCOME: Record<StepOutcome, { label: string; tone: string | undefined }> = {
  done: { label: 'Done', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  incomplete: { label: 'No result', tone: 'warning' },
  running: { label: 'Running', tone: 'running' },
};

/** The steps of the run, one button each: its number, name, outcome, duration, tokens and cost. */
export function StepList({ steps, selected, onOpen }: { steps: readonly RunStep[]; selected: number | undefined; onOpen(key: number): void }) {
  return (
    <ol className="rv-steps">
      {steps.map((step) => (
        <li key={step.key}>
          <button type="button" className="rv-step" aria-pressed={selected === step.key} aria-haspopup="dialog" onClick={() => onOpen(step.key)}>
            <span className="rv-step__head">
              <span className="rv-step__n mono">{step.index}</span>
              <span className="rv-step__title">{step.title}</span>
              <span className="tag" data-tone={OUTCOME[step.outcome].tone}>
                {OUTCOME[step.outcome].label}
              </span>
            </span>
            <span className="rv-step__facts subtle">
              <span>{step.durationS === null ? '—' : formatDuration(step.durationS)}</span>
              <span>{step.tokens === null ? 'tokens —' : `${step.tokens.toLocaleString()} tokens`}</span>
              <span title="Hermes keeps the cost of a whole session, not of a step. The run’s cost is above.">cost —</span>
              {step.toolCount > 0 && <span>{step.toolCount === 1 ? '1 tool' : `${step.toolCount} tools`}</span>}
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}

/** What a step did, drawn with Chat's cards: the words, the reasoning and every tool call with its result. Raw shows the rows as Hermes holds them. */
export function StepTranscript({ step, density }: { step: RunStep; density: RunDensity }) {
  const entries = useMemo(() => entriesOf(step.rows), [step.rows]);
  if (density === 'raw') return <pre className="rv-raw mono" tabIndex={0} aria-label={`Rows of step ${step.index}, as Hermes holds them`}>
        {JSON.stringify(step.rows, null, 2)}
      </pre>;
  return (
    <div className="rv-transcript">
      {step.failure && (
        <p className="rv-transcript__failure" role="alert">
          {step.failure}
        </p>
      )}
      {entries.length === 0 && <p className="subtle">This step has nothing to show.</p>}
      {entries.map((entry, index) =>
        entry.kind === 'activity' ? (
          <ActivityGroup key={`a${index}`} items={entry.items} mode={density} />
        ) : (
          <div key={`b${entry.id}`} className="rv-say" data-role={entry.role}>
            <p className="overline">{entry.role === 'user' ? 'Sent to the worker' : 'Worker'}</p>
            <Rich text={entry.text} anchor={`step-${step.key}-${entry.id}`} />
          </div>
        ),
      )}
    </div>
  );
}

/** A step's transcript as a sheet (phones and tablets) or a panel beside the run (1024 px and up). */
export function StepPanel({ step, density, wide, onClose }: { step: RunStep; density: RunDensity; wide: boolean; onClose(): void }) {
  const title = `Step ${step.index}: ${step.title}`;
  if (!wide) {
    return (
      <Sheet title={title} detents={['half', 'full']} onClose={onClose}>
        <StepTranscript step={step} density={density} />
      </Sheet>
    );
  }
  return (
    <aside className="rv-panel card" aria-label={title}>
      <header className="rv-panel__head">
        <h2 className="rv-panel__title">{title}</h2>
        <button type="button" className="btn btn--ghost btn--icon" aria-label="Close the step" onClick={onClose}>
          <Icon name="x" />
        </button>
      </header>
      <StepTranscript step={step} density={density} />
    </aside>
  );
}

const LOG_STATUS: Record<LogBuffer['phase'], { state: StatusState; label: string }> = {
  connecting: { state: 'reconnecting', label: 'Connecting' },
  live: { state: 'online', label: 'Live' },
  unavailable: { state: 'offline', label: 'Not reachable' },
  rejected: { state: 'failed', label: 'Refused' },
};

/** The worker log: end-anchored and virtualised, live while the run goes, with a way back to the newest line when the reader has scrolled away. */
export function WorkerLog({ log, density, runEnded }: { log: RunLogState; density: RunDensity; runEnded: boolean }) {
  const { buffer, ended, following } = log;
  const [jump, setJump] = useState(0);
  const [picked, setPicked] = useState<ReadonlySet<number>>(new Set());
  const held = heldCount(buffer);
  const rows = useMemo<LogRow[]>(() => (density === 'raw' ? buffer.rows : buffer.rows.flatMap((row) => shownLogLines([row.text], density).map((text) => ({ id: row.id, text })))), [buffer.rows, density]);
  const status = ended ? { state: 'done' as const, label: 'Ended' } : !following && buffer.phase === 'live' ? { state: 'paused' as const, label: held > 0 ? `Behind live · ${held} new` : 'Behind live' } : LOG_STATUS[buffer.phase];

  const copy = async () => {
    const text = selectedText(buffer, picked);
    const count = picked.size;
    try {
      await navigator.clipboard.writeText(text);
      toast(count === 1 ? 'Copied the line' : `Copied ${count} lines`);
      setPicked(new Set());
    } catch {
      toast('Could not copy. Select the text by hand instead.', { tone: 'danger' });
    }
  };
  const toggle = (id: number) =>
    setPicked((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <section className="rv-log" aria-labelledby="rv-log-title">
      <div className="rv-section-head">
        <h2 id="rv-log-title" className="overline">
          Worker log
        </h2>
        <StatusBadge state={status.state} label={status.label} />
        {(held > 0 || !following) && (
          <button
            type="button"
            className="btn btn--primary btn--sm"
            onClick={() => {
              log.catchUp();
              setJump((n) => n + 1);
            }}
          >
            <Icon name="chev-d" small />
            Jump to latest{held > 0 ? ` (${held} new)` : ''}
          </button>
        )}
      </div>
      <p className="subtle rv-log__note">Hermes keeps one log for each task, so it also holds the task’s other runs.{!runEnded && ' It follows this run while it goes and stops when the run ends.'}</p>
      {picked.size > 0 && (
        <div className="lg-picked" role="group" aria-label="Selected lines">
          <span>
            {picked.size} {picked.size === 1 ? 'line' : 'lines'} selected
          </span>
          <button type="button" className="btn btn--primary btn--sm" onClick={() => void copy()}>
            <Icon name="copy" small />
            {picked.size === 1 ? 'Copy line' : `Copy ${picked.size} lines`}
          </button>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setPicked(new Set())}>
            Clear
          </button>
        </div>
      )}
      {buffer.phase === 'unavailable' && buffer.message && (
        <p className="subtle" role="status">
          {buffer.message}
        </p>
      )}
      {buffer.phase === 'rejected' && (
        <p role="alert" className="rv-log__refused">
          {buffer.message}
        </p>
      )}
      <div className="lg-box rv-log__box">
        {rows.length === 0 ? (
          <div className="empty">
            <Icon name="log" />
            <h3>{buffer.phase === 'connecting' ? 'Reading the log…' : 'The log is empty'}</h3>
            <p>{buffer.phase === 'connecting' ? 'Asking Hermes for the end of the worker’s log.' : runEnded ? 'The worker wrote nothing.' : 'The worker has not written anything yet. New lines appear here as it does.'}</p>
          </div>
        ) : (
          <LogList rows={rows} search="" picked={picked} onPick={toggle} jump={jump} onFollowing={log.setFollowing} />
        )}
      </div>
    </section>
  );
}
