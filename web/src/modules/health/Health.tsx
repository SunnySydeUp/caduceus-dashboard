import { useId, useState, type CSSProperties } from 'react';
import type { Repair, RepairFix, Subsystem, SubsystemId } from '@caduceus/contracts/caduceus-api';
import { useHealth } from '../../health.ts';
import { healthSummary, recurringText, SEVERITY_VIEW, STATE_VIEW } from '../../health-view.ts';
import { Icon, type IconName } from '../../icons.tsx';
import { errorCode, fetchWithStepUp, postJson } from '../../passkeys.ts';
import { noteMeaningfulAction } from '../../shell/install.ts';
import { AppLink } from '../../shell/navigation.tsx';
import { PageHeader } from '../../shell/PageHeader.tsx';
import { StatusBadge } from '../../shell/StatusBadge.tsx';
import { Term } from '../../shell/Term.tsx';
import { confirmTier } from '../../shell/tier-confirmation.ts';
import { toast } from '../../shell/toasts.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';

const ICONS: Record<SubsystemId, IconName> = {
  caduceus: 'browser',
  backend: 'server',
  gateway: 'broadcast',
  scheduler: 'clock',
  dispatcher: 'work',
  providers: 'cpu',
  host: 'database',
  activity: 'running',
  egress: 'shield',
};

/** What the dialog says about a fix, and the toast after it. */
const FIX_TEXT: Record<RepairFix['id'], { text: string; confirmLabel: string; started: string }> = {
  'restart-backend': {
    text: 'Hermes stops and starts again. Every turn in progress is interrupted. Open pages reconnect by themselves once it is back, usually within a few seconds.',
    confirmLabel: 'Restart',
    started: 'Restarting Hermes. The connection comes back by itself.',
  },
};

const TIER_TEXT = { T2: { tier: 'Tier 2', how: 'passkey' } } as const;

const clock = new Intl.DateTimeFormat(undefined, { timeStyle: 'medium' });
const at = (iso: string) => clock.format(new Date(iso));

/** What a fix that was not carried out means for the owner. */
async function refusal(res: Response): Promise<string> {
  const code = await errorCode(res);
  if (code === 'step-up-required') return 'Not restarted: confirming with a passkey was cancelled.';
  if (res.status === 401) return 'Your session ended. Sign in again.';
  return `Caduceus could not do it (HTTP ${res.status}).`;
}

/** Health (M0 #11): every subsystem with its state, why and when it was last checked, and the Repairs they add up to. */
export function Health() {
  const { report, unreachable, checking, check } = useHealth();
  const summary = report ? healthSummary(report) : undefined;
  // This page is served by Caduceus: if it cannot be reached, that is what is wrong, whatever its last report said.
  const subsystems: Subsystem[] | undefined = report?.subsystems.map((subsystem) =>
    unreachable && subsystem.id === 'caduceus' ? { ...subsystem, state: 'down', reason: 'This page cannot reach the Caduceus server.' } : subsystem,
  );

  return (
    <div className="hl">
      <PageHeader
        overline="Observe · Repairs"
        title="Health"
        subtitle={report && summary ? `${summary.text} · checked ${at(report.checkedAt)}` : 'Is everything Hermes needs running?'}
        actions={
          <button type="button" className="btn btn--primary" onClick={() => void check()} disabled={checking} aria-busy={checking}>
            <Icon name="refresh" />
            {checking ? 'Checking…' : 'Check now'}
          </button>
        }
      />
      {unreachable && (
        <p className="banner" data-tone="warning" role="status">
          <Icon name="alert" />
          <span>Caduceus is not reachable, so {report ? `this is the report of ${at(report.checkedAt)}` : 'nothing could be checked'}. It updates by itself when the connection is back.</span>
        </p>
      )}
      {!report && !unreachable && <p role="status">Checking…</p>}
      {report && subsystems && (
        <>
          <section className="section hl-repairs" aria-labelledby="hl-repairs-title">
            <div className="section__head">
              <h2 className="section__title" id="hl-repairs-title">
                <Icon name="tool" />
                Repairs
                {report.repairs.length > 0 && (
                  <span className="count" aria-hidden="true">
                    {report.repairs.length}
                  </span>
                )}
              </h2>
            </div>
            <p className="help-text">
              <Term id="repairs">Repairs</Term> are the problems Caduceus found, each with its cause and, where there is one, a fix. One that goes away and comes back is flagged as a <Term id="recurring-failure">recurring failure</Term>.
            </p>
            {report.repairs.length > 0 ? (
              <ul className="hl-repair-list">
                {report.repairs.map((repair) => (
                  <RepairCard key={repair.id} repair={repair} subsystem={subsystems.find((s) => s.id === repair.subsystem)?.name ?? repair.subsystem} onDone={() => void check()} />
                ))}
              </ul>
            ) : (
              <div className="panel panel--pad row">
                <StatusBadge state="succeeded" label="Nothing to repair" />
                <span className="subtle">Check now looks again.</span>
              </div>
            )}
          </section>
          <section className="section hl-subs" aria-labelledby="hl-subs-title">
            <div className="section__head">
              <h2 className="section__title" id="hl-subs-title">
                <Icon name="heartbeat" />
                Subsystems
              </h2>
            </div>
            <p className="help-text">
              Each one shows its state, why, what to do about it and when Caduceus last checked. The <Term id="egress">egress proxy</Term> is Hermes’s optional guard for Docker sandboxes, and <Term id="resource-pressure">resource pressure</Term> is Hermes’s own
              warning that memory or disk is running out.
            </p>
            <ul className="hl-sublist panel">
              {subsystems.map((subsystem) => (
                <li key={subsystem.id}>
                  <SubsystemRow subsystem={subsystem} />
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}

function RepairCard({ repair, subsystem, onDone }: { repair: Repair; subsystem: string; onDone(): void }) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const severity = SEVERITY_VIEW[repair.severity];
  const { fix } = repair;

  // A fix is tiered like any other action: the shared dialog asks, the passkey is checked, the server audits it.
  const run = async (chosen: RepairFix) => {
    const words = FIX_TEXT[chosen.id];
    setBusy(true);
    try {
      const confirmed = await confirmTier({ tier: chosen.tier, moduleId: 'health', action: `health.${chosen.id}`, label: `${chosen.label}?`, text: words.text, confirmLabel: words.confirmLabel });
      if (!confirmed) return;
      const res = await fetchWithStepUp(() => postJson(`/_caduceus/api/health/fixes/${chosen.id}`));
      if (res.ok) {
        toast(words.started, { tone: 'info' });
        noteMeaningfulAction();
      } else toast(await refusal(res), { tone: 'warning' });
      onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="hl-repair" data-tone={severity.tone} aria-labelledby={`${id}-title`}>
      <div className="hl-repair__top">
        <span className="status" data-tone={severity.tone}>
          <Icon name={severity.icon} />
          <span>{severity.label}</span>
        </span>
        <span className="subtle">{subsystem}</span>
        {repair.recurring && (
          <span className="status hl-recurring" data-tone="warning">
            <Icon name="refresh" small />
            <span>{recurringText(repair.recurring)}</span>
          </span>
        )}
      </div>
      <h3 className="hl-repair__title" id={`${id}-title`}>
        {repair.title}
      </h3>
      <p className="hl-repair__cause">
        <span className="sr-only">Cause: </span>
        {repair.cause}
      </p>
      {repair.link && (
        <div className="hl-repair__foot">
          <AppLink className="btn btn--secondary btn--sm" to={repair.link.to}>
            {repair.link.label}
          </AppLink>
        </div>
      )}
      {fix && (
        <div className="hl-repair__foot">
          <WriteButton type="button" className="btn btn--primary btn--sm" disabled={busy} aria-busy={busy} aria-describedby={`${id}-tier`} onClick={() => void run(fix)}>
            <Icon name="fingerprint" />
            {fix.label}
          </WriteButton>
          <span className="hl-tier mono" id={`${id}-tier`}>
            <Term id="risk-tiers">{TIER_TEXT[fix.tier].tier}</Term> · {TIER_TEXT[fix.tier].how}
          </span>
        </div>
      )}
    </li>
  );
}

function SubsystemRow({ subsystem }: { subsystem: Subsystem }) {
  const view = STATE_VIEW[subsystem.state];
  const detailed = subsystem.facts.length > 0 || (subsystem.meters?.length ?? 0) > 0;
  const summary = (
    <>
      <span className="list-row__icon">
        <Icon name={ICONS[subsystem.id]} />
      </span>
      <span className="hl-sub__main">
        <span className="hl-sub__name">{subsystem.name}</span>
        <span className="hl-sub__reason">{subsystem.reason}</span>
        {subsystem.suggestion && (
          <span className="hl-sub__fix">
            <strong>Suggested fix:</strong> {subsystem.suggestion}
          </span>
        )}
      </span>
      <span className="hl-sub__end">
        <StatusBadge state={view.badge} label={view.label} />
        <time className="hl-sub__ago mono" dateTime={subsystem.checkedAt}>
          Checked {at(subsystem.checkedAt)}
        </time>
      </span>
    </>
  );
  // A subsystem with readings behind its state opens to show them; the one in trouble opens by itself.
  return detailed ? (
    <details className="hl-sub" open={subsystem.state === 'degraded' || subsystem.state === 'down' || undefined}>
      <summary>
        {summary}
        <Icon name="chev-d" className="hl-sub__chev" />
      </summary>
      <div className="hl-sub__body">
        {subsystem.meters && subsystem.meters.length > 0 && (
          <ul className="hl-meters">
            {subsystem.meters.map((meter) => (
              <li key={meter.label}>
                <span>{meter.label}</span>
                <span className="mono">{meter.percent}%</span>
                <span className="progress" data-tone={meter.percent >= 95 ? 'danger' : meter.percent >= 85 ? 'warning' : 'success'} role="img" aria-label={`${meter.label} ${meter.percent}%`}>
                  <i style={{ '--p': `${Math.min(100, meter.percent)}%` } as CSSProperties} />
                </span>
              </li>
            ))}
          </ul>
        )}
        {subsystem.facts.length > 0 && (
          <dl className="hl-facts">
            {subsystem.facts.map((fact) => (
              <div key={fact.label}>
                <dt>{fact.label}</dt>
                <dd>{fact.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </details>
  ) : (
    <div className="hl-sub hl-sub--flat">
      <div className="hl-sub__summary">
        {summary}
        {/* Where the others have their chevron, so every row's state lines up. */}
        <span className="hl-sub__chev" aria-hidden="true" />
      </div>
    </div>
  );
}
