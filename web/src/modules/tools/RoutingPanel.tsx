import { useState } from 'react';
import { Icon } from '../../icons.tsx';
import { Loading } from '../../shell/Loading.tsx';
import { StatusBadge, type StatusState } from '../../shell/StatusBadge.tsx';
import { Term } from '../../shell/Term.tsx';
import { toast } from '../../shell/toasts.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { AppLink } from '../../shell/navigation.tsx';
import { ActionLogSheet, type LogRun, type LogVerdict } from '../skills/ActionLogSheet.tsx';
import { judgeSetup, requestComputerUsePermissions } from './tools-actions.ts';
import { useComputerUse, usePortal } from './tools-data.ts';
import { GRANT_ACTION, type ComputerUse, type ComputerUseState, type Portal } from './tools-model.ts';
import './tools.css';

/** A web address is safe to link to only when it is a web address. */
function webAddress(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const { protocol } = new URL(url);
    return protocol === 'https:' || protocol === 'http:' ? url : undefined;
  } catch {
    return undefined;
  }
}

function ErrorBanner({ what, stale, retry }: { what: string; stale: boolean; retry(): void }) {
  return (
    <div className="banner" data-tone="danger" role="alert">
      <Icon name="alert" />
      <span className="banner__content">
        Hermes did not answer, so {what} could not be read{stale ? ': this is what it said a moment ago' : ''}.
      </span>
      <button type="button" className="btn btn--secondary btn--sm" onClick={retry}>
        <Icon name="refresh" />
        Retry
      </button>
    </div>
  );
}

function GatewayCard({ profile, portal, failed, reload }: { profile: string; portal: Portal | undefined; failed: boolean; reload(): void }) {
  const link = webAddress(portal?.subscriptionUrl);
  return (
    <section className="tl-box" aria-labelledby="tl-gateway-title">
      <div className="tl-box__head">
        <h3 id="tl-gateway-title">Tool routing</h3>
        {portal && (portal.loggedIn ? <StatusBadge state="succeeded" label={portal.freeTier ? 'Portal signed in · free tier' : 'Portal signed in'} variant="plain" /> : <StatusBadge state="offline" label="Portal not signed in" variant="plain" />)}
      </div>
      <p className="tl-note">
        <Term id="tool-gateway">Tool routing</Term> is where Hermes gets each kind of tool for <strong>{profile}</strong>: through the Nous Portal’s backends, or from a provider you set up yourself. Hermes reports this; to change a route, choose a provider in the toolset.
      </p>
      {failed && <ErrorBanner what="the routing" stale={portal !== undefined} retry={reload} />}
      {!portal && !failed && <Loading label="Loading the routing…" lines={4} onRetry={reload} />}
      {portal && portal.features.length === 0 && <p className="tl-note">Hermes reports no routed features for this profile.</p>}
      {portal && portal.features.length > 0 && (
        <ul className="tl-features" aria-label="How tools are routed">
          {portal.features.map((feature) => (
            <li key={feature.label}>
              <span>{feature.label}</span>
              <span className="tl-features__state">{feature.viaPortal ? <StatusBadge state="succeeded" label={feature.state} variant="plain" /> : <span className={feature.state === 'not configured' ? 'subtle' : undefined}>{feature.state}</span>}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="tl-actions">
        <AppLink className="btn btn--secondary btn--sm" to={`/agents/tools?profile=${encodeURIComponent(profile)}`}>
          <Icon name="tool" small />
          Choose providers
        </AppLink>
        {link && (
          <a className="btn btn--ghost btn--sm" href={link} target="_blank" rel="noreferrer noopener">
            <Icon name="external" small />
            Manage the Portal subscription
          </a>
        )}
      </div>
      {portal && !portal.loggedIn && (
        <p className="tl-note">
          To route tools through the Portal, run <code>hermes -p {profile} portal</code> on this computer.
        </p>
      )}
    </section>
  );
}

const COMPUTER_STATE: Record<ComputerUseState, { state: StatusState; label: string }> = {
  ready: { state: 'succeeded', label: 'Ready' },
  'needs-permission': { state: 'blocked', label: 'Needs permission' },
  'not-installed': { state: 'offline', label: 'Not installed' },
  unsupported: { state: 'offline', label: 'Not supported here' },
  error: { state: 'failed', label: 'Error' },
  unknown: { state: 'stale', label: 'Not known' },
};

const granted = (value: boolean | undefined) => (value === true ? 'Granted' : value === false ? 'Not granted' : 'Not known');

function ComputerUseCard({ profile, status, failed, reload }: { profile: string; status: ComputerUse | undefined; failed: boolean; reload(): void }) {
  const [busy, setBusy] = useState(false);
  const [run, setRun] = useState<LogRun>();
  const word = status ? COMPUTER_STATE[status.state] : undefined;

  const grant = async () => {
    setBusy(true);
    const outcome = await requestComputerUsePermissions(profile);
    setBusy(false);
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    if (outcome.kind === 'done') setRun({ action: GRANT_ACTION, title: 'Computer Use permissions', doneTitle: 'Permissions requested', judge: judgeSetup });
  };
  const finished = (verdict: LogVerdict) => {
    toast(verdict.ok ? 'Hermes asked macOS. Approve the dialogs, then check the status here.' : verdict.message, { tone: verdict.ok ? undefined : 'danger' });
    reload();
  };

  return (
    <section className="tl-box" aria-labelledby="tl-computer-title">
      <div className="tl-box__head">
        <h3 id="tl-computer-title">Computer use</h3>
        {word && <StatusBadge state={word.state} label={word.label} variant="plain" />}
      </div>
      <p className="tl-note">Lets an agent see and drive this computer’s screen. It needs a driver, and on a Mac two permissions that only macOS can grant. Switch it on or off in Toolsets (Computer Use).</p>
      {failed && <ErrorBanner what="Computer use" stale={status !== undefined} retry={reload} />}
      {!status && !failed && <Loading label="Loading Computer use…" lines={4} onRetry={reload} />}
      {status && (
        <>
          <ul className="tl-perms" aria-label="Computer use permissions">
            <li>
              <span>Driver</span>
              <span>{status.installed ? `Installed${status.version ? ` · ${status.version}` : ''}` : 'Not installed'}</span>
            </li>
            {status.platform === 'darwin' && (
              <>
                <li>
                  <span>Accessibility</span>
                  <span>{granted(status.accessibility)}</span>
                </li>
                <li>
                  <span>Screen recording</span>
                  <span>{granted(status.screenRecording)}</span>
                </li>
              </>
            )}
          </ul>
          {status.error && (
            <p className="tl-trouble" role="alert">
              <Icon name="alert" small /> {status.error}
            </p>
          )}
          {status.checks.length > 0 && (
            <ul className="tl-checks" aria-label="The driver’s own checks">
              {status.checks.map((check) => (
                <li key={check.label}>
                  {check.label}: {check.status}
                  {check.message ? ` — ${check.message}` : ''}
                </li>
              ))}
            </ul>
          )}
          {status.state === 'not-installed' && <p className="tl-note">Switching Computer Use on in Toolsets makes Hermes install the driver.</p>}
          {status.state === 'unsupported' && <p className="tl-note">Hermes does not support Computer use on {status.platform || 'this system'}.</p>}
          {status.installed && status.canGrant && (
            <div className="tl-actions">
              <WriteButton type="button" className={`btn ${status.ready === true ? 'btn--secondary' : 'btn--primary'}`} disabled={busy} aria-busy={busy} onClick={() => void grant()}>
                <Icon name="lock" />
                {status.ready === true ? 'Ask for the permissions again…' : 'Grant permissions…'}
              </WriteButton>
            </div>
          )}
          {status.installed && status.canGrant && <p className="tl-note">Hermes can ask for the permissions, but only you can approve them, in the dialogs macOS shows on this computer. Take one back in System Settings › Privacy &amp; Security.</p>}
        </>
      )}
      {run && <ActionLogSheet run={run} onFinished={finished} onClose={() => setRun(undefined)} />}
    </section>
  );
}

/** How Hermes routes the profile's tools (Tool routing), and Computer use's permissions. */
export function RoutingPanel({ profile }: { profile: string }) {
  const portal = usePortal(profile);
  const computer = useComputerUse(profile);
  return (
    <div className="tl-route">
      <GatewayCard profile={profile} portal={portal.value} failed={portal.failed} reload={() => void portal.reload()} />
      <ComputerUseCard profile={profile} status={computer.value} failed={computer.failed} reload={() => void computer.reload()} />
    </div>
  );
}
