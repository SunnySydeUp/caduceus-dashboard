// The runs of playbooks as a list (M6 #02): grouped by playbook on the library page, and the runs of one playbook on its detail page. The
// caller reads the runs (`useRuns`, which follows the boards' events), so one page asks once.
import type { RunSummary } from '@caduceus/contracts/playbook-runs';
import { Icon } from '../../icons.tsx';
import { AppLink } from '../../shell/navigation.tsx';
import { StatusBadge } from '../../shell/StatusBadge.tsx';
import type { RunsState } from './playbook-run-data.ts';
import { playbookPath, runPath } from './playbook-model.ts';
import { groupRuns, RUN_STATE, runsOf, startedText } from './playbook-runs-model.ts';
import './runs.css';

type Reading = RunsState & { reload(): void };

function RunRow({ run, now, showVersion }: { run: RunSummary; now: number; showVersion: boolean }) {
  const state = RUN_STATE[run.state];
  return (
    <li className="runs__row">
      <AppLink className="runs__title" to={runPath(run.playbook.id, run.root, run.board)}>
        {run.title}
      </AppLink>
      <span className="runs__meta">
        <StatusBadge state={state.badge} label={state.label} variant="plain" />
        {showVersion && <span className="mono">v{run.playbook.version}</span>}
        <span className="mono">
          {run.stagesDone}/{run.stagesTotal}
          <span className="sr-only"> stages done</span>
        </span>
        <span>{startedText(run.startedAt, now)}</span>
      </span>
    </li>
  );
}

/** What a list says while it loads, cannot be read, or has no runs. */
function Notice({ state, empty }: { state: Reading; empty: boolean }) {
  if (state.status === 'loading') return <p role="status">Loading the runs…</p>;
  if (state.status === 'failed') {
    return (
      <div className="banner" data-tone="danger" role="alert">
        <Icon name="alert" />
        <span className="banner__content">The runs could not be read: {state.error}</span>
        <button type="button" className="btn btn--secondary btn--sm" onClick={state.reload}>
          Try again
        </button>
      </div>
    );
  }
  if (!empty) return null;
  return (
    <div className="empty">
      <Icon name="play" />
      <h3>No runs yet</h3>
      <p>Open a playbook and press Run. A run makes one Kanban task for each stage, one after the other, and shows up here.</p>
    </div>
  );
}

/** Every run, grouped by playbook and version: its name, how many runs, then a row for each. */
export function RunsByPlaybook({ state }: { state: Reading }) {
  const now = Date.now() / 1000;
  const groups = state.status === 'ready' ? groupRuns(state.runs) : [];
  return (
    <div className="runs">
      <Notice state={state} empty={state.status === 'ready' && groups.length === 0} />
      {groups.map((group) => (
        <section key={group.ref} className="runs__group" aria-labelledby={`runs-${group.ref}`}>
          <h3 id={`runs-${group.ref}`}>
            <AppLink className="runs__title" to={`${playbookPath(group.playbook.id)}?version=${group.playbook.version}`}>
              {group.playbook.name} v{group.playbook.version}
            </AppLink>
            <span className="subtle">
              {group.runs.length} {group.runs.length === 1 ? 'run' : 'runs'}
            </span>
          </h3>
          <ul className="runs__list">
            {group.runs.map((run) => (
              <RunRow key={`${run.board}/${run.root}`} run={run} now={now} showVersion={false} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** The runs of one playbook, every version, newest first. */
export function RunsOfPlaybook({ state, playbookId }: { state: Reading; playbookId: string }) {
  const now = Date.now() / 1000;
  const runs = state.status === 'ready' ? runsOf(state.runs, playbookId) : [];
  return (
    <div className="runs">
      <Notice state={state} empty={state.status === 'ready' && runs.length === 0} />
      {runs.length > 0 && (
        <ul className="runs__list">
          {runs.map((run) => (
            <RunRow key={`${run.board}/${run.root}`} run={run} now={now} showVersion />
          ))}
        </ul>
      )}
    </div>
  );
}
