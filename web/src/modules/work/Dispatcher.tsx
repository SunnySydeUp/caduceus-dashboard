// The dispatcher's toolbar on Work › Board: its mode, a nudge, a dry-run preview and its settings. All of it is Hermes's: the mode and the settings are read
// from Hermes each time, the preview is Hermes's own dry run, and a save is read back before it is shown.
import { useId, useState, type FormEvent } from 'react';
import { Icon } from '../../icons.tsx';
import { closeAllLayers } from '../../overlays/layers.ts';
import { Sheet } from '../../overlays/Sheet.tsx';
import { AppLink } from '../../shell/navigation.tsx';
import { Term } from '../../shell/Term.tsx';
import { toast } from '../../shell/toasts.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { nudgeDispatcher, previewDispatch, saveSettings } from './board-actions.ts';
import type { BoardTask } from './board-model.ts';
import { dispatcherMode, settingsSummary, type DispatchReport, type DispatcherSettings, type SettingsChange } from './board-ops.ts';
import type { DispatcherState } from './board-ops-data.ts';
import { taskHref } from './TaskPeek.tsx';
import './board-ops.css';

const counted = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

/** What a dispatch said, as a sheet: which tasks start (or would), and why each of the others waits. */
function ReportSheet({ title, intro, report, tasks, slug, onNudge, onClose }: { title: string; intro: string; report: DispatchReport; tasks: ReadonlyMap<string, BoardTask>; slug: string | undefined; onNudge?(): void; onClose(): void }) {
  const name = (taskId: string) => tasks.get(taskId)?.title ?? taskId;
  // Only a preview offers to nudge: its words say "would".
  const dry = onNudge !== undefined;
  return (
    <Sheet
      title={title}
      detents={['auto', 'full']}
      onClose={onClose}
      footer={
        onNudge && (
          <>
            <button type="button" className="btn btn--secondary" onClick={onClose}>
              Close
            </button>
            <WriteButton type="button" className="btn btn--primary" onClick={onNudge}>
              Nudge now
            </WriteButton>
          </>
        )
      }
    >
      <div className="bo-report">
        <p className="subtle">{intro}</p>
        <section aria-labelledby="bo-start">
          <h3 id="bo-start" className="overline">
            {dry ? 'Would start' : 'Started'} ({report.wouldStart.length})
          </h3>
          {report.wouldStart.length === 0 ? (
            <p className="subtle">No ready task {dry ? 'would start' : 'started'}.</p>
          ) : (
            <ul className="bo-list">
              {report.wouldStart.map((item) => (
                <li key={item.taskId}>
                  <AppLink to={taskHref(item.taskId, slug)}>{name(item.taskId)}</AppLink>
                  <span className="subtle"> · {item.profile || 'no profile'}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section aria-labelledby="bo-wait">
          <h3 id="bo-wait" className="overline">
            Waiting ({report.waiting.length})
          </h3>
          {report.waiting.length === 0 ? (
            <p className="subtle">No ready task is held back.</p>
          ) : (
            <ul className="bo-list">
              {report.waiting.map((item) => (
                <li key={item.taskId}>
                  <AppLink to={taskHref(item.taskId, slug)}>{name(item.taskId)}</AppLink>
                  <span className="bo-why">{item.why}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        {report.notes.length > 0 && (
          <section aria-labelledby="bo-notes">
            <h3 id="bo-notes" className="overline">
              Hermes also
            </h3>
            <ul className="bo-list">
              {report.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </section>
        )}
        {dry && <p className="subtle bo-fine">A preview starts no worker. Hermes still does its usual tidying while it looks: it releases claims that ran out and moves tasks whose parents are done from Todo to Ready.</p>}
      </div>
    </Sheet>
  );
}

const minutesOf = (seconds: number) => String(Math.round(seconds / 60));

/** The dispatcher's limits and orchestration settings. Only what was changed is sent, and what is shown afterwards is what Hermes read back. */
function SettingsSheet({ settings, profiles, onSaved, onClose }: { settings: DispatcherSettings; profiles: readonly string[]; onSaved(): Promise<void>; onClose(): void }) {
  const id = useId();
  const [all, setAll] = useState(settings.maxInProgress === null ? '' : String(settings.maxInProgress));
  const [each, setEach] = useState(settings.maxInProgressPerProfile === null ? '' : String(settings.maxInProgressPerProfile));
  const [stale, setStale] = useState(minutesOf(settings.staleTimeoutSeconds));
  const [failures, setFailures] = useState(String(settings.failureLimit));
  const [interval, setInterval] = useState(String(settings.intervalSeconds));
  const [decompose, setDecompose] = useState(settings.autoDecompose);
  const [promote, setPromote] = useState(settings.autoPromoteChildren);
  const [orchestrator, setOrchestrator] = useState(settings.orchestratorProfile);
  const [fallback, setFallback] = useState(settings.defaultAssignee);
  const [busy, setBusy] = useState(false);

  const count = (text: string, least: number): number | null | undefined => {
    if (text.trim() === '') return null;
    const value = Number(text);
    return Number.isInteger(value) && value >= least ? value : undefined;
  };
  const wholeAt = (text: string, least: number): number | undefined => {
    const value = Number(text);
    return text.trim() !== '' && Number.isInteger(value) && value >= least ? value : undefined;
  };
  const caps = { all: count(all, 1), each: count(each, 1) };
  const staleMinutes = wholeAt(stale, 0);
  const failureLimit = wholeAt(failures, 1);
  const seconds = wholeAt(interval, 5);
  const problems = {
    all: caps.all === undefined ? 'Use a whole number from 1, or leave it empty for no limit of your own.' : undefined,
    each: caps.each === undefined ? 'Use a whole number from 1, or leave it empty for no limit.' : undefined,
    stale: staleMinutes === undefined ? 'Use whole minutes from 0, where 0 switches it off.' : undefined,
    failures: failureLimit === undefined ? 'Use a whole number from 1.' : undefined,
    interval: seconds === undefined ? 'Use whole seconds, at least 5.' : undefined,
  };
  const invalid = Object.values(problems).some(Boolean);

  const change: SettingsChange = {};
  if (caps.all !== undefined && caps.all !== settings.maxInProgress) change.maxInProgress = caps.all;
  if (caps.each !== undefined && caps.each !== settings.maxInProgressPerProfile) change.maxInProgressPerProfile = caps.each;
  if (staleMinutes !== undefined && staleMinutes * 60 !== settings.staleTimeoutSeconds && minutesOf(settings.staleTimeoutSeconds) !== stale) change.staleTimeoutSeconds = staleMinutes * 60;
  if (failureLimit !== undefined && failureLimit !== settings.failureLimit) change.failureLimit = failureLimit;
  if (seconds !== undefined && seconds !== settings.intervalSeconds) change.intervalSeconds = seconds;
  if (decompose !== settings.autoDecompose) change.autoDecompose = decompose;
  if (promote !== settings.autoPromoteChildren) change.autoPromoteChildren = promote;
  if (orchestrator !== settings.orchestratorProfile) change.orchestratorProfile = orchestrator;
  if (fallback !== settings.defaultAssignee) change.defaultAssignee = fallback;
  const changed = Object.keys(change).length > 0;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (invalid || !changed) return;
    setBusy(true);
    await closeAllLayers();
    const outcome = await saveSettings(change, settingsSummary(settings, change));
    setBusy(false);
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    if (outcome.kind === 'done') {
      await onSaved();
      toast('Saved. The dispatcher shows what Hermes now holds.');
    }
  };

  const number = (key: keyof typeof problems, label: string, value: string, set: (text: string) => void, help: string, placeholder?: string) => (
    <div className="field">
      <label className="field__label" htmlFor={`${id}-${key}`}>
        {label}
      </label>
      <input id={`${id}-${key}`} className="input mono" inputMode="numeric" autoComplete="off" value={value} placeholder={placeholder} aria-invalid={problems[key] ? true : undefined} aria-describedby={`${id}-${key}-help`} onChange={(event) => set(event.target.value)} />
      <p id={`${id}-${key}-help`} className={problems[key] ? 'field__error' : 'field__help'}>
        {problems[key] ?? help}
      </p>
    </div>
  );
  const select = (key: string, label: string, value: string, set: (text: string) => void, none: string, help: string) => (
    <div className="field">
      <label className="field__label" htmlFor={`${id}-${key}`}>
        {label}
      </label>
      <select id={`${id}-${key}`} className="input" value={value} aria-describedby={`${id}-${key}-help`} onChange={(event) => set(event.target.value)}>
        <option value="">{none}</option>
        {[...new Set([...profiles, ...(value ? [value] : [])])].map((profile) => (
          <option key={profile} value={profile}>
            {profile}
          </option>
        ))}
      </select>
      <p id={`${id}-${key}-help`} className="field__help">
        {help}
      </p>
    </div>
  );

  return (
    <Sheet
      title="Dispatcher settings"
      detents={['full']}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            Cancel
          </button>
          <WriteButton type="submit" form={`${id}-form`} className="btn btn--primary" disabled={busy || invalid || !changed}>
            Save settings
          </WriteButton>
        </>
      }
    >
      <form id={`${id}-form`} className="bo-form" onSubmit={(event) => void submit(event)}>
        <p className="subtle">
          These are Hermes’s settings for the <Term id="dispatcher">dispatcher</Term>, kept in its configuration. Saving asks for your passkey.
        </p>
        <fieldset className="bo-set">
          <legend>How many workers</legend>
          {number('all', 'Workers at once', all, setAll, `Across every board on this Mac. Empty means no limit of your own${settings.maxInProgress === null ? ' (now)' : ''}; Hermes may still hold some back when memory is short.`, 'No limit')}
          {number('each', 'Workers per profile', each, setEach, 'The most one profile runs at once, so one profile’s model or quota is not swamped. Empty for none.', 'No limit')}
        </fieldset>
        <fieldset className="bo-set">
          <legend>Time and failures</legend>
          {number('stale', 'Reclaim a silent worker after (minutes)', stale, setStale, `A running task that sends no sign of life for this long is reclaimed to Ready. 0 switches it off. Now ${settings.staleTimeoutSeconds === 0 ? 'off' : `${minutesOf(settings.staleTimeoutSeconds)} minutes`}.`)}
          {number('failures', 'Block a task after this many failed attempts', failures, setFailures, 'Starts that fail, crash or run out of time, one after another. Giving the task to another profile starts the count again.')}
          {number('interval', 'Look for ready tasks every (seconds)', interval, setInterval, 'Lower picks tasks up sooner; higher is gentler on Hermes.')}
        </fieldset>
        <fieldset className="bo-set">
          <legend>Orchestration</legend>
          <label className="bo-check">
            <input type="checkbox" checked={decompose} onChange={(event) => setDecompose(event.target.checked)} />
            <span>
              Split Triage tasks into subtasks by itself
              <small className="subtle">Hermes uses its model on each Triage task. Off, you press Decompose yourself.</small>
            </span>
          </label>
          <label className="bo-check">
            <input type="checkbox" checked={promote} onChange={(event) => setPromote(event.target.checked)} />
            <span>
              Move a task’s children to Ready when it is done
              <small className="subtle">Off, they stay in Todo until you move them.</small>
            </span>
          </label>
          {select('orchestrator', 'Orchestrator profile', orchestrator, setOrchestrator, `Hermes’s choice (${settings.effectiveOrchestrator || 'the default profile'})`, 'The profile that owns the root task after a split.')}
          {select('fallback', 'Profile for tasks nobody has', fallback, setFallback, 'None: they wait in Ready', 'A ready task with no profile is given to this one, and its worker starts it.')}
        </fieldset>
      </form>
    </Sheet>
  );
}

/** The dispatcher's mode and its three controls. */
export function DispatcherBar({ dispatcher, tasks, profiles, slug }: { dispatcher: DispatcherState; tasks: readonly BoardTask[]; profiles: readonly string[]; slug: string | undefined }) {
  const [sheet, setSheet] = useState<{ kind: 'preview' | 'nudged'; report: DispatchReport } | { kind: 'settings' }>();
  const [busy, setBusy] = useState<'preview' | 'nudge'>();
  const { settings, gatewayRunning, phase } = dispatcher;
  const ready = tasks.filter((task) => task.status === 'ready').map((task) => task.id);
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const mode = settings && gatewayRunning !== undefined ? dispatcherMode(settings, gatewayRunning) : undefined;

  const preview = async () => {
    setBusy('preview');
    const outcome = await previewDispatch(ready, slug);
    setBusy(undefined);
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    else setSheet({ kind: 'preview', report: outcome.report });
  };
  const nudge = async () => {
    await closeAllLayers();
    setBusy('nudge');
    const outcome = await nudgeDispatcher(ready, slug);
    setBusy(undefined);
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    else if (outcome.kind === 'done') setSheet({ kind: 'nudged', report: outcome.report });
  };

  return (
    <section className="bo-disp" aria-label="Dispatcher">
      <div className="bo-disp__mode">
        <span className="bo-disp__label">
          <Icon name="bolt" />
          Dispatcher
        </span>
        {mode ? (
          <>
            <span className="tag" data-tone={mode.state === 'auto' ? 'success' : mode.state === 'manual' ? 'warning' : 'danger'} data-mode={mode.state}>
              {mode.label}
            </span>
            <span className="subtle bo-disp__detail">
              {mode.detail} {mode.limits}
            </span>
          </>
        ) : (
          <span className="subtle bo-disp__detail" role={phase === 'failed' ? 'alert' : 'status'}>
            {phase === 'failed' ? 'Hermes did not say how the dispatcher is set.' : 'Reading the dispatcher…'}
          </span>
        )}
      </div>
      <div className="bo-disp__acts">
        <button type="button" className="btn btn--secondary btn--sm" aria-haspopup="dialog" disabled={busy !== undefined} aria-busy={busy === 'preview'} onClick={() => void preview()}>
          <Icon name="eye" />
          Preview
        </button>
        <WriteButton type="button" className="btn btn--secondary btn--sm" disabled={busy !== undefined} aria-busy={busy === 'nudge'} onClick={() => void nudge()}>
          <Icon name="play" />
          Nudge
        </WriteButton>
        <button type="button" className="btn btn--ghost btn--sm" aria-haspopup="dialog" disabled={settings === undefined} onClick={() => setSheet({ kind: 'settings' })}>
          <Icon name="sliders" />
          Settings
        </button>
      </div>

      {sheet?.kind === 'preview' && (
        <ReportSheet
          title="Preview: what a nudge would do"
          intro="Hermes’s dry run: which ready tasks it would start now, and why it would leave the others."
          report={sheet.report}
          tasks={byId}
          slug={slug}
          onNudge={() => void nudge()}
          onClose={() => setSheet(undefined)}
        />
      )}
      {sheet?.kind === 'nudged' && <ReportSheet title="Dispatcher nudged" intro="Hermes dispatched just now. Workers that started show on the board as Running." report={sheet.report} tasks={byId} slug={slug} onClose={() => setSheet(undefined)} />}
      {sheet?.kind === 'settings' && settings && <SettingsSheet settings={settings} profiles={profiles} onSaved={dispatcher.reload} onClose={() => setSheet(undefined)} />}
    </section>
  );
}
