// Step 4: opt in to notifications, by the rules of Settings › Notifications (M2 #03): iOS only gives a web page notifications once it is on the Home Screen,
// so there the install guide comes first; permission is asked for only from the button (`enablePush`), never by itself; a browser that cannot receive push,
// or that was told no, is told so. What is offered is decided by `push-offer.ts`; this only draws it.
import { useCallback, useEffect, useState } from 'react';
import { Icon } from '../../icons.tsx';
import { type PushOffer } from '../../push-offer.ts';
import { enablePush, readOffer, sendTestPush } from '../../push-client.ts';
import { openInstallGuide } from '../../shell/install.ts';
import { AppLink } from '../../shell/navigation.tsx';
import { Term } from '../../shell/Term.tsx';
import { toast } from '../../shell/toasts.ts';

export function StepNotifications() {
  const [offer, setOffer] = useState<PushOffer>();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();

  const load = useCallback(async () => setOffer(await readOffer()), []);
  useEffect(() => void load(), [load]);
  // The owner may come back from the install guide, or from the browser's site settings, with the answer changed.
  useEffect(() => {
    const visible = () => document.visibilityState === 'visible' && void load();
    document.addEventListener('visibilitychange', visible);
    return () => document.removeEventListener('visibilitychange', visible);
  }, [load]);

  const run = async (work: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setProblem(undefined);
    try {
      await work();
      toast(done);
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : 'That did not work.');
    } finally {
      setBusy(false);
      await load();
    }
  };

  return (
    <div className="stack">
      <p>
        A <Term id="push-subscription">push notification</Term> reaches this device when Caduceus is closed: an agent waiting for a decision, a job that failed. It is optional and it is for this device only. You choose what to be told of in <AppLink to="/settings/notifications">Settings › Notifications</AppLink>.
      </p>
      {offer === undefined && <p role="status">Checking this device…</p>}
      {offer === 'needs-install' && (
        <div className="ob-block">
          <p role="status">On iPhone and iPad, notifications work once Caduceus is on your Home Screen. That is how iOS decides which web apps may notify you. Your place in this guide is saved, so you can add it to the Home Screen and come back here.</p>
          <div>
            <button type="button" className="btn btn--primary" onClick={openInstallGuide}>
              <Icon name="download" />
              Show me how
            </button>
          </div>
        </div>
      )}
      {offer === 'unsupported' && <p role="status">This browser cannot receive push notifications. Chrome, Edge, Firefox and Safari 16.4 or later can. You can finish without them.</p>}
      {offer === 'denied' && <p role="status">Notifications are blocked for Caduceus in this browser. Allow them in the browser’s site settings, then come back. You can finish without them.</p>}
      {offer === 'ready' && (
        <div className="ob-block">
          <p>Your browser will ask for permission when you choose Turn on notifications.</p>
          <div>
            <button type="button" className="btn btn--primary" disabled={busy} aria-busy={busy} onClick={() => void run(enablePush, 'Notifications are on for this device.')}>
              <Icon name="bolt" />
              Turn on notifications
            </button>
          </div>
        </div>
      )}
      {offer === 'subscribed' && (
        <div className="ob-block">
          <p role="status">Notifications are on for this device.</p>
          <div>
            <button type="button" className="btn btn--secondary" disabled={busy} aria-busy={busy} onClick={() => void run(sendTestPush, 'Test notification sent.')}>
              Send a test notification
            </button>
          </div>
        </div>
      )}
      {problem && (
        <p className="ob-check__detail" role="alert">
          <Icon name="alert" small /> {problem}
        </p>
      )}
    </div>
  );
}
