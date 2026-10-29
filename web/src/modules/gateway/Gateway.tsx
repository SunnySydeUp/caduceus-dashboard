import { useState } from 'react';
import { useHealth } from '../../health.ts';
import { STATE_VIEW } from '../../health-view.ts';
import { runGatewayAction, type GatewayVerb } from '../../gateway-actions.ts';
import { Icon, type IconName } from '../../icons.tsx';
import { closeAllLayers } from '../../overlays/layers.ts';
import { Sheet } from '../../overlays/Sheet.tsx';
import { Sigil, UnassignedSigil } from '../../shell/Sigil.tsx';
import { AppLink } from '../../shell/navigation.tsx';
import { Loading } from '../../shell/Loading.tsx';
import { PageHeader } from '../../shell/PageHeader.tsx';
import { StatusBadge } from '../../shell/StatusBadge.tsx';
import { Term } from '../../shell/Term.tsx';
import { toast } from '../../shell/toasts.ts';
import { useSizeClass } from '../../shell/use-size-class.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { type GatewayAction, type GatewayRow, gatewayModeLabel, gatewayProcesses, gatewayRows, isUnconfigured, plainDuration } from './gateway-model.ts';
import { useGateways, type GatewaysView } from './gateway-data.ts';
import './gateway.css';

const ACTION_ICONS: Record<GatewayAction['id'], IconName> = { start: 'play', stop: 'stop', restart: 'refresh', drain: 'paused', 'cancel-drain': 'play' };

/** The sentence a finished action gets: Hermes has begun it, and the page follows what Hermes then reports. */
const STARTED: Record<GatewayVerb, string> = {
  start: 'Starting the gateway of',
  stop: 'Stopping the gateway of',
  restart: 'Restarting the gateway of',
  drain: 'Draining the gateway of',
  'cancel-drain': 'Cancelled the drain of',
};

const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function platformTone(state: string): 'success' | 'danger' | 'warning' | 'neutral' {
  if (state === 'connected') return 'success';
  if (state === 'fatal' || state === 'disconnected' || state === 'startup_failed') return 'danger';
  if (state === 'retrying' || state === 'paused' || state === 'pending_restart') return 'warning';
  return 'neutral';
}

function Since({ iso }: { iso: string }) {
  const seconds = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  return (
    <span title={dateTime.format(new Date(iso))}>
      <Icon name="clock" small /> Up {plainDuration(seconds)}
    </span>
  );
}

function GatewayCard({ row, onAction, onMenu, compact, busy }: { row: GatewayRow; onAction(action: GatewayAction): void; onMenu(): void; compact: boolean; busy: boolean }) {
  return (
    <li className="gw-card" data-state={row.badge}>
      <div className="gw-card__top">
        <Sigil name={row.profile} size="md" />
        <div className="gw-card__id">
          <h2 className="gw-card__name">
            <AppLink to={`/agents/profiles/${row.profile}`}>{row.profile}</AppLink>
          </h2>
          <StatusBadge state={row.badge} label={`Gateway ${row.statusLabel.toLowerCase()}`} variant="plain" />
        </div>
        {compact && (
          <button type="button" className="btn btn--secondary btn--sm gw-card__more" aria-haspopup="dialog" aria-label={`Actions for the gateway of ${row.profile}`} onClick={onMenu}>
            <Icon name="dots-v" />
            Actions
          </button>
        )}
      </div>
      <ul className="gw-card__meta">
        {row.startedAt && (
          <li>
            <Since iso={row.startedAt} />
          </li>
        )}
        {row.pid !== undefined && (
          <li className="mono">
            <span className="sr-only">Process id: </span>pid {row.pid}
          </li>
        )}
        {row.running && row.activeAgents > 0 && (
          <li>
            <Icon name="running" small /> {row.activeAgents === 1 ? '1 agent working' : `${row.activeAgents} agents working`}
          </li>
        )}
      </ul>
      {row.platforms.length > 0 && (
        <ul className="gw-card__platforms" aria-label={`Channels of ${row.profile}`}>
          {row.platforms.map((platform) => (
            <li key={platform.name}>
              <span className="tag" data-tone={platformTone(platform.state)}>
                {platform.name} · {platform.state.replaceAll('_', ' ')}
              </span>
            </li>
          ))}
        </ul>
      )}
      {row.notes.map((note) => (
        <p key={note} className="gw-card__note">
          {note}
        </p>
      ))}
      {!compact && (
        <div className="gw-card__actions">
          {row.actions.map((action) => (
            <WriteButton key={action.id} type="button" className={action.id === 'start' || action.id === 'restart' ? 'btn btn--secondary' : 'btn btn--ghost'} disabled={busy} onClick={() => onAction(action)}>
              <Icon name={ACTION_ICONS[action.id]} />
              {action.label}
            </WriteButton>
          ))}
        </div>
      )}
    </li>
  );
}

/** A gateway's actions on a phone, in a sheet: each one a labelled button with its tier (mobile spec §2: nothing sits behind a gesture). */
function ActionSheet({ row, onAction, onClose }: { row: GatewayRow; onAction(action: GatewayAction): void; onClose(): void }) {
  return (
    <Sheet title={`Gateway of ${row.profile}`} detents={['auto']} onClose={onClose}>
      <ul className="gw-acts">
        {row.actions.map((action) => (
          <li key={action.id}>
            <WriteButton
              type="button"
              className="gw-act"
              onClick={() => {
                onClose();
                // The sheet is closed before the confirmation opens, so the layers never stack.
                void closeAllLayers().then(() => onAction(action));
              }}
            >
              <Icon name={ACTION_ICONS[action.id]} />
              <span>
                <span>{action.label}</span>
                <small>{action.tier === 'T1' ? 'You confirm first' : 'You confirm, then use your passkey'}</small>
              </span>
            </WriteButton>
          </li>
        ))}
        {row.actions.length === 0 && <li className="subtle">Nothing can be done to this gateway from here.</li>}
      </ul>
    </Sheet>
  );
}

function HealthBadge() {
  const { report, unreachable } = useHealth();
  const gateway = report?.subsystems.find((subsystem) => subsystem.id === 'gateway');
  if (!gateway) return <span className="subtle">{unreachable ? 'Health is not available right now.' : 'Checking health…'}</span>;
  const view = STATE_VIEW[gateway.state];
  return (
    <span className="gw-health">
      <StatusBadge state={view.badge} label={`Health: ${view.label.toLowerCase()}`} variant="plain" />
      <span className="gw-health__reason">{gateway.reason}</span>
    </span>
  );
}

function Empty({ view }: { view: GatewaysView }) {
  const [busy, setBusy] = useState(false);
  const root = view.cards?.find((card) => card.isRoot)?.name ?? 'default';
  const start = async () => {
    setBusy(true);
    const outcome = await runGatewayAction('start', root);
    setBusy(false);
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    else if (outcome.kind === 'done') {
      toast(`${STARTED.start} ${root}`);
      await view.reload();
    }
  };
  return (
    <div className="empty">
      <span className="empty__icon">
        <Icon name="broadcast" />
      </span>
      <p>No gateway is running, and no channel is set up yet. Start a gateway, or set up a channel for it to serve.</p>
      <div className="row">
        <WriteButton type="button" className="btn btn--primary" disabled={busy} onClick={() => void start()}>
          <Icon name="play" />
          Start gateway
        </WriteButton>
        <AppLink className="btn btn--secondary" to="/connect/channels">
          <Icon name="plug" />
          Open Channels
        </AppLink>
      </div>
    </div>
  );
}

/** Connect › Gateway: for every profile, whether its messaging gateway runs, and the actions on it. */
export function Gateway() {
  const view = useGateways();
  const size = useSizeClass();
  const compact = size === 'compact';
  const [menu, setMenu] = useState<string>();
  const [busy, setBusy] = useState(false);
  const inputs = { cards: view.cards ?? [], statuses: view.statuses, topology: view.topology, startedAt: view.facts?.startedAt ?? {} };
  const rows = gatewayRows(inputs);
  const processes = gatewayProcesses(inputs);
  const running = rows.filter((row) => row.running).length;
  const mode = view.topology?.gateway_mode;
  const modeLabel = gatewayModeLabel(mode);
  const unconfigured = view.cards !== undefined && isUnconfigured(rows, view.channels);

  const perform = async (row: GatewayRow, action: GatewayAction) => {
    setBusy(true);
    try {
      const outcome = await runGatewayAction(action.id, row.profile, { alsoServes: row.alsoServes, activeAgents: row.activeAgents });
      if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
      else if (outcome.kind === 'done') {
        toast(`${STARTED[action.id]} ${row.profile}`, { detail: 'The dot follows what Hermes reports.' });
        await view.reload();
      }
    } finally {
      setBusy(false);
    }
  };
  const menuRow = rows.find((row) => row.profile === menu);

  return (
    <div className="gw">
      <PageHeader
        overline="Connect"
        title="Gateway"
        subtitle={view.cards ? `${running} of ${rows.length} gateway${rows.length === 1 ? '' : 's'} running${modeLabel ? ` · ${modeLabel}` : ''}` : 'Whether each profile’s messaging gateway is running.'}
        actions={
          mode === 'multiple' && (
            <AppLink className="btn btn--secondary" to="/connect/gateway/migrate">
              <Icon name="stack" />
              Move to one shared gateway
            </AppLink>
          )
        }
      />
      <p className="help-text">
        The <Term id="gateway">gateway</Term> connects Hermes to chat platforms. A host runs either {`“One gateway per profile”`} or {`“One shared gateway”`} (a <Term id="multiplexed-gateway">multiplexed gateway</Term> that serves every profile). Before a restart or an update, a <Term id="drain">drain</Term> lets work in progress finish.
      </p>
      <div className="gw-health-row">
        <HealthBadge />
      </div>
      {view.failed && (
        <div className="banner gw-error" data-tone="danger" role="alert">
          <Icon name="alert" />
          <span className="banner__content">Hermes did not answer, so its gateways could not be read{view.cards ? ': this is what it said a moment ago' : ''}.</span>
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => void view.reload()}>
            <Icon name="refresh" />
            Retry
          </button>
        </div>
      )}
      {!view.cards && !view.failed && <Loading label="Loading gateways…" lines={3} onRetry={() => void view.reload()} />}
      {unconfigured ? (
        <Empty view={view} />
      ) : (
        rows.length > 0 && (
          <ul className="gw-cards" aria-label="Gateways">
            {rows.map((row) => (
              <GatewayCard key={row.profile} row={row} compact={compact} busy={busy} onAction={(action) => void perform(row, action)} onMenu={() => setMenu(row.profile)} />
            ))}
          </ul>
        )
      )}
      {processes.length > 0 && (
        <section className="gw-procs" aria-labelledby="gw-procs-title">
          <h2 id="gw-procs-title" className="gw-section">
            Running gateway processes
          </h2>
          <ul className="gw-proc-list">
            {processes.map((process) => (
              <li key={process.owner} className="panel panel--pad gw-proc">
                <p className="gw-proc__head">
                  <span className="mono">{process.pid !== undefined ? `pid ${process.pid}` : 'pid unknown'}</span>
                  <span>of {process.owner}</span>
                  {process.startedAt && <Since iso={process.startedAt} />}
                </p>
                <p className="gw-proc__line">Serves {process.serves.join(', ')}</p>
                {process.ports.length > 0 && (
                  <p className="gw-proc__line mono">
                    {process.ports.map(({ platform, port }) => `${platform} :${port}`).join(' · ')}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {menuRow && <ActionSheet row={menuRow} onAction={(action) => void perform(menuRow, action)} onClose={() => setMenu(undefined)} />}
    </div>
  );
}
