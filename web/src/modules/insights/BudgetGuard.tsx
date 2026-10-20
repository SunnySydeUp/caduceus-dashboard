// Observe › Insights › Budget guard (M6 #06): whether the guard is armed, tripped (what it paused and when) or off, when it last looked, how far spending can
// run past a budget before it acts, the actions it recorded, Undo guard actions, and the switches. All of it is read from Caduceus's own guard; what it paused is
// in Hermes (the dispatcher's claim list and scheduled jobs).
import { useCallback, useEffect, useState } from 'react';
import type { GuardAction, GuardState, GuardTrip } from '@caduceus/contracts/budget-guard';
import { Icon } from '../../icons.tsx';
import { Term } from '../../shell/Term.tsx';
import { toast } from '../../shell/toasts.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { fetchTiered } from '../../tiered.ts';
import { runTiered } from '../profiles/profile-actions.ts';
import { dollars } from './budgets-model.ts';

const ROUTE = '/_caduceus/api/budget-guard';
const when = (at: number) => new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** The documented overshoot bound in words: the guard reads spend every interval, so spend can pass a budget by what it burns in one interval. */
export function overshootWords(intervalMs: number): string {
  if (intervalMs <= 0) return 'The guard reads spend only when asked to.';
  const seconds = Math.round(intervalMs / 1000);
  const every = seconds % 60 === 0 ? (seconds === 60 ? 'minute' : `${seconds / 60} minutes`) : `${seconds} seconds`;
  return `It reads spend every ${every}, so spend can pass a budget by about ${every === 'minute' ? 'a minute' : every} of spending at the rate of the moment (interval × burn rate) before it acts. Workers already running finish.`;
}

const STATUS_WORDS: Record<GuardAction['status'], string> = { paused: 'Paused', resumed: 'Resumed', skipped: 'Left alone' };

function Trip({ trip, onUndo, busy }: { trip: GuardTrip; onUndo(trip: GuardTrip): void; busy: boolean }) {
  const scope = trip.profile === undefined ? 'every profile' : `the “${trip.profile}” profile`;
  const held = trip.actions.filter((action) => action.status === 'paused');
  return (
    <li className="panel panel--pad ins-trip" data-settled={trip.settled ? '' : undefined}>
      <h3>
        {dollars(trip.spent)} of {dollars(trip.amount)} {trip.period === 'day' ? 'daily' : trip.period === 'week' ? 'weekly' : 'monthly'} budget for {scope}
      </h3>
      <p className="subtle">
        Tripped {when(trip.at)}, in the period from {trip.periodStart} (UTC).
      </p>
      {trip.actions.length === 0 ? (
        <p className="subtle">It had nothing to pause: the dispatcher and the jobs were stopped or exempted already.</p>
      ) : (
        <ul className="ins-trip__actions">
          {trip.actions.map((action) => (
            <li key={action.id}>
              <span className="tag" data-tone={action.status === 'paused' ? 'warning' : undefined}>
                {STATUS_WORDS[action.status]}
              </span>{' '}
              {action.label}
              {action.reason && <span className="subtle"> — {action.reason}</span>}
            </li>
          ))}
        </ul>
      )}
      {held.length > 0 && (
        <WriteButton type="button" className="btn btn--secondary btn--sm" disabled={busy} onClick={() => onUndo(trip)}>
          <Icon name="history" small />
          Undo guard actions
        </WriteButton>
      )}
    </li>
  );
}

export function BudgetGuard() {
  const [state, setState] = useState<GuardState>();
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(ROUTE).catch(() => undefined);
    const body = res?.ok ? ((await res.json().catch(() => undefined)) as GuardState | undefined) : undefined;
    setState(body);
    setFailed(body === undefined);
  }, []);
  useEffect(() => {
    void load();
    const onVisible = () => document.visibilityState === 'visible' && void load();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [load]);

  const send = async (method: 'POST' | 'PUT', path: string, body: Record<string, unknown> | undefined, confirm: Parameters<typeof fetchTiered>[0]['confirm'], done: string) => {
    setBusy(true);
    try {
      const outcome = await runTiered(fetchTiered({ method, path, ...(body === undefined ? {} : { body }), ...(confirm === undefined ? {} : { confirm }) }));
      if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
      if (outcome.kind === 'done') toast(done, { tone: 'success' });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const undo = (trip: GuardTrip) => {
    const held = trip.actions.filter((action) => action.status === 'paused').map((action) => action.label);
    return send('POST', `${ROUTE}/undo`, { tripId: trip.id }, { title: 'Undo the guard’s actions?', text: `This resumes exactly what the guard paused: ${held.join(', ')}. Anything you changed since is left as it is, and the next entry says so.`, object: 'the guard’s pauses', confirmLabel: 'Resume' }, 'Resumed what the guard paused');
  };

  return (
    <section className="ins-guard" aria-labelledby="ins-guard-title">
      <div className="section__head">
        <h2 id="ins-guard-title" className="section__title">
          Budget guard
        </h2>
        {state && (
          <span className="tag" data-tone={state.mode === 'tripped' ? 'danger' : state.mode === 'disabled' ? 'warning' : 'success'}>
            {state.mode === 'armed' ? 'Armed' : state.mode === 'tripped' ? 'Tripped' : 'Off'}
          </span>
        )}
      </div>
      <p className="subtle ins-note">
        The <Term id="budget-guard">budget guard</Term> stops <Term id="unattended-work">unattended work</Term> when a budget is used up: Hermes’s Kanban dispatcher stops starting workers and scheduled jobs are paused, except jobs you exempt on their Schedules page. Chats are never paused. It puts back only what it paused itself.
      </p>
      {failed && (
        <div className="banner" data-tone="warning" role="alert">
          <Icon name="alert" />
          <span className="banner__content">Caduceus could not read the budget guard.</span>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => void load()}>
            Retry
          </button>
        </div>
      )}
      {state && (
        <>
          <p className="subtle">
            {state.lastEvaluation === undefined ? 'It has not looked at spending yet.' : `Last looked at spending ${when(state.lastEvaluation)}.`} {overshootWords(state.intervalMs)}
          </p>
          <div className="switch-row">
            <label htmlFor="ins-guard-lift">
              <strong id="ins-guard-lift-name">Lift its pauses when a new period starts</strong>
            </label>
            <button type="button" id="ins-guard-lift" className="switch" role="switch" aria-checked={state.liftOnNewPeriod} aria-labelledby="ins-guard-lift-name" disabled={busy} onClick={() => void send('PUT', `${ROUTE}/settings`, { liftOnNewPeriod: !state.liftOnNewPeriod }, undefined, state.liftOnNewPeriod ? 'It will wait for you to undo' : 'It will lift its pauses at a new period')} />
          </div>
          <div className="row">
            {state.enabled ? (
              <WriteButton type="button" className="btn btn--danger-quiet btn--sm" disabled={busy} onClick={() => void send('POST', `${ROUTE}/disable`, undefined, { title: 'Turn the budget guard off?', text: 'Nothing will stop unattended work when a budget is used up. Pauses the guard already made stay until you undo them. This needs your passkey.', object: 'the budget guard', confirmLabel: 'Turn off' }, 'The budget guard is off')}>
                Turn the guard off…
              </WriteButton>
            ) : (
              <WriteButton type="button" className="btn btn--primary btn--sm" disabled={busy} onClick={() => void send('POST', `${ROUTE}/enable`, undefined, undefined, 'The budget guard is armed')}>
                Turn the guard on
              </WriteButton>
            )}
          </div>
          {state.trips.length === 0 ? (
            <p className="subtle">{state.enabled ? 'It has not tripped. When a budget is used up, what it paused is listed here.' : 'It is off, so no budget stops anything.'}</p>
          ) : (
            <ul className="ins-triplist" aria-label="Guard trips">
              {state.trips.map((trip) => (
                <Trip key={trip.id} trip={trip} busy={busy} onUndo={(chosen) => void undo(chosen)} />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
