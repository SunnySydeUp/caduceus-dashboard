// The notification switch of one scheduled job (M3 #09): whether its failures show in Notices and are pushed. It is a preference of Caduceus's,
// kept for the job's profile and id; the job in Hermes is not changed. A per-device override in Settings › Notifications still has the last word on push.
import { useEffect, useState } from 'react';
import { toast } from '../../shell/toasts.ts';
import { fetchTiered } from '../../tiered.ts';
import { runTiered } from '../profiles/profile-actions.ts';

const route = (profile: string, id: string) => `/_caduceus/api/work/jobs/${encodeURIComponent(profile)}/${encodeURIComponent(id)}/notifications`;

export function JobNotifications({ profile, id }: { profile: string; id: string }) {
  const [enabled, setEnabled] = useState<boolean>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let current = true;
    setEnabled(undefined);
    void fetch(route(profile, id))
      .then((res) => (res.ok ? (res.json() as Promise<{ enabled: boolean }>) : undefined))
      .then((body) => current && setEnabled(body?.enabled));
    return () => {
      current = false;
    };
  }, [profile, id]);
  const change = async (next: boolean) => {
    setBusy(true);
    try {
      const outcome = await runTiered(fetchTiered({ method: 'PUT', path: route(profile, id), body: { enabled: next } }));
      if (outcome.kind === 'done') setEnabled(next);
      else if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    } catch {
      toast('Caduceus could not save this.', { tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="jd__def" aria-labelledby="jd-notify">
      <h2 id="jd-notify">Notifications</h2>
      <div className="switch-row">
        <label htmlFor="jd-notify-on">
          <strong id="jd-notify-name">Tell me when this job fails</strong>
        </label>
        <button type="button" id="jd-notify-on" className="switch" role="switch" aria-checked={enabled ?? true} aria-labelledby="jd-notify-name" disabled={enabled === undefined || busy} onClick={() => void change(!(enabled ?? true))} />
      </div>
      <p className="subtle">Off hides its failures from Notices and sends no push. The job itself is not changed, and it keeps running.</p>
    </section>
  );
}

const exemptRoute = (profile: string, id: string) => `/_caduceus/api/work/jobs/${encodeURIComponent(profile)}/${encodeURIComponent(id)}/guard-exempt`;

/** Whether the budget guard may pause this job when a budget is used up (M6 #06): a preference of Caduceus's, kept for the job's profile and id. */
export function JobGuardExemption({ profile, id }: { profile: string; id: string }) {
  const [exempt, setExempt] = useState<boolean>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let current = true;
    setExempt(undefined);
    void fetch(exemptRoute(profile, id))
      .then((res) => (res.ok ? (res.json() as Promise<{ exempt: boolean }>) : undefined))
      .then((body) => current && setExempt(body?.exempt));
    return () => {
      current = false;
    };
  }, [profile, id]);
  const change = async (next: boolean) => {
    setBusy(true);
    try {
      const outcome = await runTiered(fetchTiered({ method: 'PUT', path: exemptRoute(profile, id), body: { exempt: next } }));
      if (outcome.kind === 'done') setExempt(next);
      else if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    } catch {
      toast('Caduceus could not save this.', { tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="jd__def" aria-labelledby="jd-guard">
      <h2 id="jd-guard">Budget guard</h2>
      <div className="switch-row">
        <label htmlFor="jd-guard-on">
          <strong id="jd-guard-name">Keep running when a budget is used up</strong>
        </label>
        <button type="button" id="jd-guard-on" className="switch" role="switch" aria-checked={exempt ?? false} aria-labelledby="jd-guard-name" disabled={exempt === undefined || busy} onClick={() => void change(!(exempt ?? false))} />
      </div>
      <p className="subtle">Off: this job counts as unattended work, and the budget guard pauses it when a budget is used up. On: the guard leaves it running.</p>
    </section>
  );
}
