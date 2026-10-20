// System › Maintenance › Diagnostics (M5 #13): Hermes's own checks (doctor, security audit, prompt size, support dump, config migrate) with their output live,
// the debug share, this install's facts with Copy for bug report, the two drained restarts, and the way to the console. Hermes runs everything; this page asks.
import { useState } from 'react';
import { Icon } from '../../icons.tsx';
import { AppLink } from '../../shell/navigation.tsx';
import { Term } from '../../shell/Term.tsx';
import { toast } from '../../shell/toasts.ts';
import { useSizeClass } from '../../shell/use-size-class.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { ActionOutputSheet } from './ActionOutputSheet.tsx';
import { consoleHiddenOn } from './console-model.ts';
import { restart, runDiagnostic, shareDebug, type DebugShare } from './diagnostics-actions.ts';
import { useInstallFacts } from './diagnostics-data.ts';
import { bugReportText, DIAGNOSTIC_ACTIONS, type DiagnosticAction } from './diagnostics-model.ts';
import { MaintenanceFrame } from './MaintenanceFrame.tsx';
import './maintenance.css';

/** How many of the newest log lines a debug share includes. */
const SHARE_LINES = 200;

function ChecksSection({ onRan }: { onRan(action: DiagnosticAction): void }) {
  const [busy, setBusy] = useState<string>();
  const run = async (action: DiagnosticAction) => {
    setBusy(action.id);
    const outcome = await runDiagnostic(action);
    setBusy(undefined);
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    if (outcome.kind === 'done') onRan(action);
  };
  return (
    <section className="mt-news" aria-labelledby="mt-checks">
      <h2 id="mt-checks" className="mt-section__title">
        Checks
      </h2>
      <ul className="mt-cards mt-plain">
        {DIAGNOSTIC_ACTIONS.map((action) => (
          <li key={action.id} className="mt-card" data-action={action.id}>
            <h3 className="mt-card__name">{action.label}</h3>
            <p className="mt-note">{action.summary}</p>
            <div className="mt-card__actions">
              <WriteButton type="button" className="btn btn--secondary btn--sm" disabled={busy !== undefined} aria-busy={busy === action.id} aria-label={`Run ${action.label}`} onClick={() => void run(action)}>
                <Icon name="play" small />
                Run
              </WriteButton>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function DebugShareSection() {
  const [busy, setBusy] = useState(false);
  const [shared, setShared] = useState<DebugShare>();
  const share = async () => {
    setBusy(true);
    const outcome = await shareDebug(SHARE_LINES);
    setBusy(false);
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    if (outcome.kind === 'done') setShared(outcome.body);
  };
  const failures = shared ? (Array.isArray(shared.failures) ? shared.failures : Object.entries(shared.failures).map(([name, why]) => `${name}: ${why}`)) : [];
  return (
    <section className="mt-card" aria-labelledby="mt-share">
      <h2 id="mt-share" className="mt-card__name">
        Debug share
      </h2>
      <p className="mt-note">
        Uploads a <Term id="debug-share">debug report</Term> and the newest {SHARE_LINES} log lines to Hermes’s paste service and gives you links to send with a bug report. Hermes removes the keys and tokens it recognises first. The links are public to anyone who has them. It is a <Term id="risk-tiers">Tier 3</Term> action: a passkey, and you type “debug share”.
      </p>
      <div className="mt-card__actions">
        <WriteButton type="button" className="btn btn--secondary btn--sm" disabled={busy} aria-busy={busy} onClick={() => void share()}>
          <Icon name="send" small />
          Upload debug report
        </WriteButton>
      </div>
      {shared && (
        <div role="status">
          <p className="mt-note">
            {shared.redacted ? 'Hermes redacted secrets before uploading.' : 'Hermes did not say it redacted anything: treat the links as sensitive.'}
            {shared.autoDeleteSeconds ? ` The pastes are deleted after ${Math.round(shared.autoDeleteSeconds / 3600)} hour${Math.round(shared.autoDeleteSeconds / 3600) === 1 ? '' : 's'}.` : ''}
          </p>
          <ul className="mt-list">
            {Object.entries(shared.urls).map(([name, url]) => (
              <li key={name}>
                {name}:{' '}
                {/^https:\/\//.test(url) ? (
                  <a href={url} target="_blank" rel="noopener noreferrer">
                    {url}
                  </a>
                ) : (
                  url
                )}
              </li>
            ))}
          </ul>
          {failures.length > 0 && <p className="mt-error">Hermes could not upload: {failures.join('; ')}</p>}
        </div>
      )}
    </section>
  );
}

function FactsSection() {
  const { facts, failed, reload } = useInstallFacts();
  const copy = async () => {
    if (!facts) return;
    try {
      await navigator.clipboard.writeText(bugReportText(facts));
      toast('Copied for a bug report', { detail: 'Versions only: no paths, names or keys.' });
    } catch {
      toast('Could not copy. Select the facts and copy them by hand.', { tone: 'danger' });
    }
  };
  return (
    <section className="mt-card" aria-labelledby="mt-facts">
      <h2 id="mt-facts" className="mt-card__name">
        Install facts
      </h2>
      {facts ? (
        <dl className="mt-facts">
          <dt>Caduceus</dt>
          <dd>{facts.caduceus.version}</dd>
          <dt>Node</dt>
          <dd>{facts.caduceus.node}</dd>
          <dt>Platform</dt>
          <dd>
            {facts.caduceus.platform} {facts.caduceus.arch}
          </dd>
          <dt>Hermes</dt>
          <dd>
            {facts.hermes.version ?? 'unknown version'} ({facts.hermes.state})
          </dd>
          <dt>Contracts</dt>
          <dd>
            pinned {facts.contracts.pinned}, Hermes {facts.contracts.hermes ?? 'unknown'}, {facts.contracts.state}
            {facts.contracts.differences.length > 0 && (
              <ul className="mt-list">
                {facts.contracts.differences.map((difference) => (
                  <li key={difference}>{difference}</li>
                ))}
              </ul>
            )}
          </dd>
          <dt>Hermes host</dt>
          <dd>{facts.host.role === null ? 'unknown' : `${facts.host.role}${facts.host.protocolVersion === null ? '' : `, protocol ${facts.host.protocolVersion}`}`}</dd>
        </dl>
      ) : (
        <p role="status">{failed ? 'Caduceus did not answer.' : 'Loading…'}</p>
      )}
      <div className="mt-card__actions">
        <button type="button" className="btn btn--secondary btn--sm" disabled={!facts} onClick={() => void copy()}>
          <Icon name="copy" small />
          Copy for bug report
        </button>
        <button type="button" className="btn btn--ghost btn--sm" aria-label="Refresh the install facts" onClick={() => void reload()}>
          <Icon name="refresh" small />
          Refresh
        </button>
      </div>
    </section>
  );
}

function RestartSection() {
  const [busy, setBusy] = useState(false);
  const go = async (target: 'backend' | 'caduceus') => {
    setBusy(true);
    const outcome = await restart(target);
    setBusy(false);
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    if (outcome.kind === 'done') toast(target === 'backend' ? 'Restarting the Hermes backend' : 'Restarting Caduceus', { detail: 'New turns are paused until it is back. This page reconnects by itself.' });
  };
  return (
    <section className="mt-card" aria-labelledby="mt-restart">
      <h2 id="mt-restart" className="mt-card__name">
        Restart
      </h2>
      <p className="mt-note">
        Both restarts are <Term id="risk-tiers">Tier 2</Term> (a passkey) and start with a <Term id="update-drain">drain</Term>: no new turns, then the restart. Every open page reconnects by itself.
      </p>
      <div className="mt-card__actions">
        <WriteButton type="button" className="btn btn--secondary btn--sm" disabled={busy} onClick={() => void go('backend')}>
          <Icon name="refresh" small />
          Restart Hermes backend
        </WriteButton>
        <WriteButton type="button" className="btn btn--secondary btn--sm" disabled={busy} onClick={() => void go('caduceus')}>
          <Icon name="refresh" small />
          Restart Caduceus
        </WriteButton>
      </div>
    </section>
  );
}

function ConsoleSection() {
  const hidden = consoleHiddenOn(useSizeClass());
  return (
    <section className="mt-card" aria-labelledby="mt-console">
      <h2 id="mt-console" className="mt-card__name">
        Console
      </h2>
      <p className="mt-note">
        Hermes’s restricted <code className="mt-code">hermes&gt;</code> prompt. Hermes runs only its own commands there, never a shell, and asks before one that changes something. Opening it is a Tier 2 action and every command is audited.
        {hidden ? ' A terminal is hard to use on a phone, so it is hidden here.' : ''}
      </p>
      <div className="mt-card__actions">
        <AppLink className="btn btn--secondary btn--sm" to="/system/maintenance/console">
          <Icon name="terminal" small />
          {hidden ? 'Open anyway' : 'Open console'}
        </AppLink>
      </div>
    </section>
  );
}

export function Diagnostics() {
  const [following, setFollowing] = useState<{ action: DiagnosticAction; run: number }>();
  return (
    <MaintenanceFrame tab="diagnostics" subtitle="Checks, install facts, restarts and the console">
      <p className="help-text">
        Hermes runs these on this Mac and Caduceus shows what they print as it comes. A <Term id="support-dump">support dump</Term> and the <Term id="doctor">doctor</Term> are the usual first steps for a bug report.
      </p>
      <ChecksSection onRan={(action) => setFollowing((before) => ({ action, run: (before?.run ?? 0) + 1 }))} />
      <div className="mt-cards">
        <FactsSection />
        <RestartSection />
        <ConsoleSection />
        <DebugShareSection />
      </div>
      {following && <ActionOutputSheet action={following.action} run={following.run} onClose={() => setFollowing(undefined)} />}
    </MaintenanceFrame>
  );
}
