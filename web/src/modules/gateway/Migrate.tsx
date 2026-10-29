import { useState } from 'react';
import { runGatewayMigration } from '../../gateway-actions.ts';
import { Icon } from '../../icons.tsx';
import { AppLink } from '../../shell/navigation.tsx';
import { PageHeader } from '../../shell/PageHeader.tsx';
import { Term } from '../../shell/Term.tsx';
import { toast } from '../../shell/toasts.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { StatusBadge } from '../../shell/StatusBadge.tsx';
import { Loading } from '../../shell/Loading.tsx';
import { GATEWAY_PER_PROFILE, SHARED_GATEWAY, gatewayRows, migrationView, type MigrationState } from './gateway-model.ts';
import { useGateways, useMigrationPlan } from './gateway-data.ts';
import './gateway.css';

const HEADLINES: Record<MigrationState, string> = {
  ready: 'Nothing blocks the move.',
  blocked: 'The move is blocked.',
  done: 'One shared gateway already serves every profile. There is nothing to move.',
  resume: 'An earlier move stopped half way. Running it again finishes it.',
  nothing: 'There is only one profile, so there is nothing to share.',
  unknown: 'Hermes did not give a plan that Caduceus can read.',
};

/** Connect › Gateway › Migrate: Hermes's plan for moving to one multiplexed gateway, with its blockers, and the run (Tier 2) only when nothing blocks it. */
export function Migrate() {
  const { plan, failed, reload } = useMigrationPlan();
  const gateways = useGateways();
  const [busy, setBusy] = useState(false);
  const view = plan === undefined ? undefined : migrationView(plan);
  // The same rows, with the same status, as Connect › Gateway.
  const rows = gatewayRows({ cards: gateways.cards ?? [], statuses: gateways.statuses, topology: gateways.topology, startedAt: gateways.facts?.startedAt ?? {} });

  const run = async () => {
    setBusy(true);
    try {
      const outcome = await runGatewayMigration();
      if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
      else if (outcome.kind === 'done') {
        toast('Moving to one shared gateway', { detail: 'Hermes is stopping each gateway and starting the one. This page follows what it reports.' });
        await reload();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="gw">
      <PageHeader overline="Connect · Gateway" title="Move to one shared gateway" subtitle={`Move from ${GATEWAY_PER_PROFILE.toLowerCase()} to ${SHARED_GATEWAY.toLowerCase()}.`} />
      <p className="help-text">
        <Term id="multiplexed-gateway">One shared gateway</Term> serves every profile from one process; the alternative is one gateway per profile. Hermes checks the host first and lists anything that blocks the move.
      </p>
      {failed && (
        <div className="banner gw-error" data-tone="danger" role="alert">
          <Icon name="alert" />
          <span className="banner__content">Hermes did not answer, so the plan could not be read.</span>
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => void reload()}>
            <Icon name="refresh" />
            Retry
          </button>
        </div>
      )}
      {!view && !failed && <Loading label="Reading the plan…" lines={3} onRetry={() => void reload()} />}
      {view && (
        <div className="stack">
          <section className="panel panel--pad gw-plan" aria-labelledby="gw-plan-title">
            <h2 id="gw-plan-title" className="gw-section">
              {HEADLINES[view.state]}
            </h2>
            {view.blockers.length > 0 && (
              <ul className="gw-blockers" id="gw-blockers" aria-label="Blockers">
                {view.blockers.map((blocker) => (
                  <li key={blocker} className="gw-blocker">
                    <Icon name="blocked" />
                    <span>{blocker}</span>
                  </li>
                ))}
              </ul>
            )}
            {view.notices.length > 0 && (
              <ul className="gw-notices" aria-label="Notices">
                {view.notices.map((notice) => (
                  <li key={notice}>
                    <Icon name="info" small />
                    <span>{notice}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {rows.length > 0 && (
            <section className="panel panel--pad" aria-labelledby="gw-today-title">
              <h2 id="gw-today-title" className="gw-section">
                Gateways today
              </h2>
              <ul className="gw-today">
                {rows.map((row) => {
                  const planned = view.gateways.find((gateway) => gateway.profile === row.profile);
                  const pid = row.pid ?? planned?.pid;
                  return (
                    <li key={row.profile}>
                      <span>
                        {row.profile} <StatusBadge state={row.badge} label={`Gateway ${row.statusLabel.toLowerCase()}`} variant="plain" />
                      </span>
                      <span className="mono subtle">
                        {row.servedBy ? `served by ${row.servedBy}` : pid !== undefined ? `pid ${pid}` : 'no process'}
                        {planned?.service ? ` · ${planned.service}` : ''}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
          <div className="row">
            {view.state !== 'done' && view.state !== 'nothing' && (
              <WriteButton type="button" className="btn btn--primary" disabled={!view.canRun || busy} aria-busy={busy} aria-describedby={view.blockers.length > 0 ? 'gw-blockers' : undefined} onClick={() => void run()}>
                <Icon name="stack" />
                {view.state === 'resume' ? 'Finish the move' : 'Move to one shared gateway'}
              </WriteButton>
            )}
            <AppLink className={view.state === 'done' || view.state === 'nothing' ? 'btn btn--primary' : 'btn btn--secondary'} to="/connect/gateway">
              Back to Gateway
            </AppLink>
          </div>
          {view.command && (
            <p className="help-text">
              The same, from a terminal: <code className="mono">{view.command}</code>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
