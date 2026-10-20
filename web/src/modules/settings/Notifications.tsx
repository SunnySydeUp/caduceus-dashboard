import { useCallback, useEffect, useId, useState } from 'react';
import { PUSH_CATEGORIES, type PushCategory, type PushDeviceState, type PushDigest } from '@caduceus/contracts/push';
import { Icon } from '../../icons.tsx';
import { type PushOffer } from '../../push-offer.ts';
import { disablePush, enablePush, readDeviceState, readOffer, savePushSettings, sendTestPush } from '../../push-client.ts';
import { openInstallGuide } from '../../shell/install.ts';
import { PageHeader } from '../../shell/PageHeader.tsx';
import { Term } from '../../shell/Term.tsx';
import { toast } from '../../shell/toasts.ts';

/** What each category tells the owner, under its name. */
const CATEGORY_HELP: Record<PushCategory, string> = {
  approvals: 'A tool approval or a question an agent is waiting on. The title is the decision, and tapping it opens it.',
  reviews: 'A task waiting for your review, or blocked on a question for you.',
  failures: 'A scheduled job or a task that failed, a gateway that is down, anything Health reports as broken.',
  finished: 'A chat run that finished while you were away.',
  pairing: 'Someone asking to be paired with your bot.',
  budget: 'A spending limit reached.',
  updates: 'A Hermes update is available.',
};

const DIGESTS: Record<PushDigest, string> = { off: 'Send each one', hourly: 'One message an hour', daily: 'One message a day, at 09:00' };

interface CronJob {
  id: string;
  name: string;
  profile: string;
}

/** The jobs of every profile, for the per-job switches; a Hermes that does not answer just has none to list. */
async function readJobs(): Promise<CronJob[]> {
  const res = await fetch('/api/cron/jobs?profile=all');
  if (!res.ok) return [];
  const body: unknown = await res.json().catch(() => undefined);
  const rows = Array.isArray(body) ? (body as unknown[]) : [];
  return rows.flatMap((row) => {
    if (typeof row !== 'object' || row === null) return [];
    const job = row as Record<string, unknown>;
    if (typeof job.id !== 'string') return [];
    const profile = typeof job.profile === 'string' ? job.profile : typeof job.profile_name === 'string' ? job.profile_name : 'default';
    return [{ id: job.id, name: typeof job.name === 'string' && job.name !== '' ? job.name : job.id, profile }];
  });
}

type Override = 'default' | 'on' | 'off';

/** Settings › Notifications: whether this device is told, and of what. */
export function Notifications() {
  const ids = useId();
  const [offer, setOffer] = useState<PushOffer>();
  const [device, setDevice] = useState<PushDeviceState>();
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  const load = useCallback(async () => {
    const [nextOffer, state] = await Promise.all([readOffer(), readDeviceState().catch(() => undefined)]);
    setOffer(nextOffer);
    setDevice(state);
  }, []);
  useEffect(() => {
    void load();
    void readJobs().then(setJobs, () => undefined);
  }, [load]);

  const run = async (work: () => Promise<void>, done: string) => {
    setBusy(true);
    try {
      await work();
      setStatus(done);
      // A change to a switch shows in the switch; the other buttons would otherwise leave no sign that anything happened.
      if (done !== 'Saved.') toast(done, { tone: 'info' });
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : 'That did not work.';
      setStatus(message);
      toast(message, { tone: 'danger' });
    } finally {
      setBusy(false);
      await load();
    }
  };

  const change = (patch: Record<string, unknown>) => void run(async () => setDevice(await savePushSettings(patch)), 'Saved.');
  const settings = device?.settings;
  const overrideOf = (ref: string): Override => (settings?.overrides[ref] === true ? 'on' : settings?.overrides[ref] === false ? 'off' : 'default');
  // A job that was switched on or off and is no longer in Hermes's list is still listed, so that its switch can be cleared.
  const listedRefs = new Set(jobs.map((job) => `cron:${job.profile}:${job.id}`));
  const orphaned = Object.keys(settings?.overrides ?? {}).filter((ref) => !listedRefs.has(ref));

  return (
    <div className="page-stack">
      <PageHeader
        title="Notifications"
        subtitle={
          <>
            A <Term id="push-subscription">push notification</Term> reaches this device when Caduceus is closed. What you choose here is for this device only.
          </>
        }
      />
      <p className="sr-only" role="status">
        {status}
      </p>
      <section className="settings-section" aria-labelledby={`${ids}-device`} data-setting-field="notifications/device" tabIndex={-1}>
        <h2 id={`${ids}-device`}>This device</h2>
        {offer === undefined && <p className="help-text">Checking this device…</p>}
        {offer === 'needs-install' && (
          <>
            <p>On iPhone and iPad, notifications work once Caduceus is on your Home Screen. That is how iOS decides which web apps may notify you.</p>
            <div className="settings-actions">
              <button type="button" className="btn btn--primary" onClick={openInstallGuide}>
                <Icon name="download" />
                Show me how
              </button>
            </div>
          </>
        )}
        {offer === 'unsupported' && <p role="status">This browser cannot receive push notifications. Chrome, Edge, Firefox and Safari 16.4 or later can.</p>}
        {offer === 'denied' && <p role="status">Notifications are blocked for Caduceus in this browser. Allow them in the browser’s site settings, then come back here.</p>}
        {offer === 'ready' && (
          <>
            <p>Turn this on to be told when an agent needs a decision, even with Caduceus closed. Your browser will ask for permission.</p>
            <div className="settings-actions">
              <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void run(async () => void (await enablePush()), 'Notifications are on for this device.')}>
                <Icon name="bolt" />
                Turn on notifications
              </button>
            </div>
          </>
        )}
        {offer === 'subscribed' && (
          <>
            <p role="status">Notifications are on for this device.</p>
            <div className="settings-actions">
              <button type="button" className="btn btn--secondary" disabled={busy} onClick={() => void run(sendTestPush, 'Test notification sent.')}>
                Send a test notification
              </button>
              <button type="button" className="btn btn--secondary" disabled={busy} onClick={() => void run(disablePush, 'Notifications are off for this device.')}>
                Turn off
              </button>
            </div>
            <p className="help-text">No notification is sent while any Caduceus window of yours is open and in view (<Term id="presence">presence</Term>).</p>
          </>
        )}
      </section>
      {offer !== 'subscribed' && offer !== undefined && (
        // A settings search can land here before this device is subscribed: say where the settings are rather than leave the jump with nothing to show.
        <>
          <section className="settings-section" aria-labelledby={`${ids}-categories`} data-setting-field="notifications/categories" tabIndex={-1}>
            <h2 id={`${ids}-categories`}>What to be told of</h2>
            <p className="help-text">You choose what to be told of once notifications are on for this device. Turn them on above first.</p>
          </section>
          <section className="settings-section" aria-labelledby={`${ids}-quiet`} data-setting-field="notifications/quiet-hours" tabIndex={-1}>
            <h2 id={`${ids}-quiet`}>Quiet hours</h2>
            <p className="help-text">
              <Term id="quiet-hours">Quiet hours</Term> hold notifications back for a stretch of the day. You set them once notifications are on for this device. Turn them on above first.
            </p>
          </section>
        </>
      )}
      {offer === 'subscribed' && settings && (
        <>
          <section className="settings-section" aria-labelledby={`${ids}-categories`} data-setting-field="notifications/categories" tabIndex={-1}>
            <h2 id={`${ids}-categories`}>What to be told of</h2>
            <ul className="settings-list">
              {(Object.keys(PUSH_CATEGORIES) as PushCategory[]).map((category) => (
                <li key={category} className="switch-row settings-row">
                  <label htmlFor={`${ids}-${category}`} className="settings-row-text">
                    <strong id={`${ids}-${category}-name`}>{PUSH_CATEGORIES[category]}</strong>
                    <span className="help-text">{CATEGORY_HELP[category]}</span>
                  </label>
                  <button
                    type="button"
                    id={`${ids}-${category}`}
                    className="switch"
                    role="switch"
                    aria-checked={settings.categories[category]}
                    aria-labelledby={`${ids}-${category}-name`}
                    disabled={busy}
                    onClick={() => change({ categories: { [category]: !settings.categories[category] } })}
                  />
                </li>
              ))}
            </ul>
          </section>
          <section className="settings-section" aria-labelledby={`${ids}-quiet`} data-setting-field="notifications/quiet-hours" tabIndex={-1}>
            <h2 id={`${ids}-quiet`}>Quiet hours</h2>
            <p className="help-text">
              <Term id="quiet-hours">Quiet hours</Term> hold notifications back for a stretch of the day.
            </p>
            <div className="switch-row">
              <label htmlFor={`${ids}-quiet-on`}>
                <strong id={`${ids}-quiet-name`}>Hold notifications back</strong>
                <br />
                <span className="help-text">Anything still waiting when they end is sent then. Times are in this device’s time zone ({settings.timeZone}).</span>
              </label>
              <button type="button" id={`${ids}-quiet-on`} className="switch" role="switch" aria-checked={settings.quietHours.enabled} aria-labelledby={`${ids}-quiet-name`} disabled={busy} onClick={() => change({ quietHours: { enabled: !settings.quietHours.enabled } })} />
            </div>
            {settings.quietHours.enabled && (
              <div className="settings-actions">
                <label htmlFor={`${ids}-from`}>From</label>
                <QuietTime id={`${ids}-from`} value={settings.quietHours.start} onCommit={(start) => change({ quietHours: { start } })} />
                <label htmlFor={`${ids}-to`}>To</label>
                <QuietTime id={`${ids}-to`} value={settings.quietHours.end} onCommit={(end) => change({ quietHours: { end } })} />
              </div>
            )}
          </section>
          <section className="settings-section" aria-labelledby={`${ids}-digest`} data-setting-field="notifications/digest" tabIndex={-1}>
            <h2 id={`${ids}-digest`}>Digest</h2>
            <p className="help-text">Finished runs and updates are only news. A digest sends them together instead of one by one. Approvals, failures and pairing always come at once.</p>
            <label htmlFor={`${ids}-digest-pick`} className="sr-only">
              How to send finished runs and updates
            </label>
            <select id={`${ids}-digest-pick`} className="input" value={settings.digest} disabled={busy} onChange={(event) => change({ digest: event.target.value })}>
              {(Object.keys(DIGESTS) as PushDigest[]).map((digest) => (
                <option key={digest} value={digest}>
                  {DIGESTS[digest]}
                </option>
              ))}
            </select>
          </section>
          <section className="settings-section" aria-labelledby={`${ids}-sources`} data-setting-field="notifications/scheduled-jobs" tabIndex={-1}>
            <h2 id={`${ids}-sources`}>Scheduled jobs</h2>
            <p className="help-text">A job’s own choice beats its category: turn one on while Failures are off, or silence a noisy one while they are on.</p>
            {jobs.length === 0 && orphaned.length === 0 && <p className="help-text">No scheduled jobs.</p>}
            <ul className="settings-list">
              {jobs.map((job) => {
                const ref = `cron:${job.profile}:${job.id}`;
                return <SourceRow key={ref} id={`${ids}-${ref}`} label={`${job.name} (${job.profile})`} value={overrideOf(ref)} busy={busy} onChange={(value) => change({ overrides: { [ref]: value === 'default' ? null : value === 'on' } })} />;
              })}
              {orphaned.map((ref) => (
                <SourceRow key={ref} id={`${ids}-${ref}`} label={ref} value={overrideOf(ref)} busy={busy} onChange={(value) => change({ overrides: { [ref]: value === 'default' ? null : value === 'on' } })} />
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}

/** A time of day that is saved when the box is left, not at each key: a time box reports every segment typed, and each report would race the one before it. */
function QuietTime({ id, value, onCommit }: { id: string; value: string; onCommit(value: string): void }) {
  const [draft, setDraft] = useState<string>();
  // Once Caduceus answers with the saved time, the box shows that.
  useEffect(() => setDraft(undefined), [value]);
  return (
    <input
      id={id}
      className="input"
      type="time"
      value={draft ?? value}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft !== undefined && draft !== '' && draft !== value) onCommit(draft);
        else setDraft(undefined);
      }}
    />
  );
}

function SourceRow({ id, label, value, busy, onChange }: { id: string; label: string; value: Override; busy: boolean; onChange(value: Override): void }) {
  return (
    <li className="settings-row">
      <label htmlFor={id} className="settings-row-text">
        {label}
      </label>
      <select id={id} className="input" value={value} disabled={busy} onChange={(event) => onChange(event.target.value as Override)}>
        <option value="default">Follow its category</option>
        <option value="on">Always notify</option>
        <option value="off">Never notify</option>
      </select>
    </li>
  );
}
