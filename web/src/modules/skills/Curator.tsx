import { useCallback, useRef, useState } from 'react';
import { Icon } from '../../icons.tsx';
import { useLiveLoad } from '../../gateway.ts';
import { useProfileScope } from '../../shell/profile-context.tsx';
import { toast } from '../../shell/toasts.ts';
import { Term } from '../../shell/Term.tsx';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { ActionLogSheet, type LogRun } from './ActionLogSheet.tsx';
import { SkillsFrame } from './SkillsFrame.tsx';
import { runCuratorNow, setCuratorPaused } from './hub-actions.ts';
import { fetchCurator } from './hub-data.ts';
import type { CuratorStatus } from './hub-model.ts';
import './skills.css';

/** The profile's curator as Hermes says, loaded now and at every `gateway.ready`, never on a timer. */
function useCurator(profile: string) {
  const [status, setStatus] = useState<CuratorStatus>();
  const [failed, setFailed] = useState(false);
  const latest = useRef(0);
  const reload = useCallback(async () => {
    const request = ++latest.current;
    try {
      const next = await fetchCurator(profile);
      if (request !== latest.current) return;
      setStatus(next);
      setFailed(false);
    } catch {
      if (request === latest.current) setFailed(true);
    }
  }, [profile]);
  useLiveLoad(() => void reload());
  return { status, failed, reload };
}

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const hours = (count: number) => (count % 24 === 0 && count >= 48 ? `${count / 24} days` : `${count} ${count === 1 ? 'hour' : 'hours'}`);

function CuratorScreen({ profile }: { profile: string }) {
  const { status, failed, reload } = useCurator(profile);
  const [run, setRun] = useState<LogRun>();
  const [busy, setBusy] = useState(false);

  const toggle = async (paused: boolean) => {
    setBusy(true);
    try {
      const outcome = await setCuratorPaused(profile, paused);
      if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
      if (outcome.kind !== 'done') return;
      await reload();
      toast(paused ? `The curator of ${profile} is paused` : `The curator of ${profile} is running on its schedule again`, { tone: 'info' });
    } finally {
      setBusy(false);
    }
  };
  const runNow = async () => {
    setBusy(true);
    try {
      const outcome = await runCuratorNow(profile);
      if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
      if (outcome.kind !== 'done') return;
      setRun({
        action: outcome.body.action,
        title: `Curator review of ${profile}`,
        doneTitle: `The curator reviewed ${profile}`,
        async judge(log) {
          await reload();
          return log.exitCode === 0 ? { ok: true, message: 'Hermes finished the review. The log says what it changed.' } : { ok: false, message: `Hermes stopped with exit code ${log.exitCode ?? 'unknown'}. The log says why.` };
        },
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sk">
      {failed && (
        <div className="banner pf-error" data-tone="danger" role="alert">
          <Icon name="alert" />
          <span className="banner__content">Hermes did not answer, so the curator’s status could not be read{status ? ': this is what it said a moment ago' : ''}.</span>
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => void reload()}>
            <Icon name="refresh" />
            Retry
          </button>
        </div>
      )}
      {!status && !failed && <p role="status">Asking Hermes about the curator…</p>}
      {status && (
        <section className="panel sk-curator" aria-labelledby="sk-curator-title">
          <h2 id="sk-curator-title" className="section__title">
            Curator of {profile}
          </h2>
          <ul className="sk-tags" aria-label="Curator status">
            <li className="tag" data-tone={status.enabled ? 'success' : 'neutral'}>
              {status.enabled ? 'On in Hermes’s config' : 'Off in Hermes’s config'}
            </li>
            <li className="tag" data-tone={status.paused ? 'paused' : 'running'}>
              <Icon name={status.paused ? 'paused' : 'running'} small />
              {status.paused ? 'Paused' : 'Active'}
            </li>
          </ul>
          <dl className="sk-facts-grid">
            <div>
              <dt>Last review</dt>
              <dd>{status.lastRunAt ? <time dateTime={status.lastRunAt}>{when(status.lastRunAt)}</time> : 'Never yet'}</dd>
            </div>
            {status.intervalHours !== undefined && (
              <div>
                <dt>Reviews every</dt>
                <dd>{hours(status.intervalHours)}, when the agent is idle{status.minIdleHours !== undefined ? ` for ${hours(status.minIdleHours)}` : ''}</dd>
              </div>
            )}
            {status.staleAfterDays !== undefined && (
              <div>
                <dt>A skill goes stale after</dt>
                <dd>{status.staleAfterDays} days unused</dd>
              </div>
            )}
            {status.archiveAfterDays !== undefined && (
              <div>
                <dt>And is archived after</dt>
                <dd>{status.archiveAfterDays} days unused</dd>
              </div>
            )}
          </dl>
          {!status.enabled && <p className="muted">The curator is off in this profile’s config, so Hermes starts no reviews. Run now still works.</p>}
          <div className="row sk-curator__actions">
            <WriteButton type="button" className="btn btn--secondary" disabled={busy} onClick={() => void toggle(!status.paused)}>
              <Icon name={status.paused ? 'play' : 'paused'} />
              {status.paused ? 'Resume' : 'Pause'}
            </WriteButton>
            <WriteButton type="button" className="btn btn--primary" disabled={busy} onClick={() => void runNow()}>
              <Icon name="bolt" />
              Run now
            </WriteButton>
          </div>
          <p className="subtle sk-note">Pause and Resume ask you to confirm. Run now needs your passkey, because the review archives skills.</p>
        </section>
      )}
      {run && <ActionLogSheet run={run} onClose={() => setRun(undefined)} onFinished={(verdict) => toast(verdict.ok ? run.doneTitle : `${run.title}: it did not finish`, { tone: verdict.ok ? 'success' : 'danger', detail: verdict.message })} />}
    </div>
  );
}

/** Agents › Skills › Curator. */
export function Curator() {
  const { effective } = useProfileScope();
  return (
    <SkillsFrame title="Curator">
      <p className="help-text">
        The <Term id="curator">curator</Term> is Hermes’s background keeper of its skills: it marks skills that are never used, archives the oldest, and never deletes one.
      </p>
      {effective ? <CuratorScreen key={effective.name} profile={effective.name} /> : <p role="status">Loading…</p>}
    </SkillsFrame>
  );
}
