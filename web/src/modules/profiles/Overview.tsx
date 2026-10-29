import { useCallback, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useGatewayEvent, useLiveLoad } from '../../gateway.ts';
import { Icon } from '../../icons.tsx';
import { Sheet } from '../../overlays/Sheet.tsx';
import { AppLink } from '../../shell/navigation.tsx';
import { Term } from '../../shell/Term.tsx';
import { toast } from '../../shell/toasts.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { GatewayBadge } from './GatewayBadge.tsx';
import { autoDescribe, saveDescription, type Described } from './profile-actions.ts';
import { fetchOverview, type Overview as OverviewData } from './profiles-data.ts';
import type { ProfileCard } from './profiles-model.ts';
import type { TabProps } from './ProfileDetail.tsx';

const number = new Intl.NumberFormat();

/** Overview numbers, asked of Hermes again when the profile's sessions or Hermes itself change. Nothing is stored. */
function useOverview(card: ProfileCard): { overview: OverviewData | undefined; reload(): void } {
  const [overview, setOverview] = useState<OverviewData>();
  const latest = useRef(0);
  const load = useCallback(() => {
    const request = ++latest.current;
    void fetchOverview(card).then((next) => request === latest.current && setOverview(next));
  }, [card]);
  useLiveLoad(load);
  useGatewayEvent('sessions.changed', load);
  return { overview, reload: load };
}

function Stat({ label, value, children }: { label: string; value: string; children?: ReactNode }) {
  return (
    <div className="panel panel--pad stat">
      <p className="overline">{label}</p>
      <p className="stat__value">{value}</p>
      {children}
    </div>
  );
}

/** The owner edits the description by hand, or asks Hermes to write one and then keeps, edits or puts back what it wrote. */
function About({ card, reload }: { card: ProfileCard; reload(): Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(card.description);
  const [busy, setBusy] = useState(false);
  const [proposal, setProposal] = useState<{ text: string; previous: string }>();

  const save = async () => {
    setBusy(true);
    const outcome = await saveDescription(card.name, draft);
    setBusy(false);
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    if (outcome.kind !== 'done') return;
    setEditing(false);
    toast('Description saved', { tone: 'info' });
    await reload();
  };
  const describe = async () => {
    setBusy(true);
    const outcome = await autoDescribe(card);
    setBusy(false);
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    if (outcome.kind !== 'done') return;
    const result: Described = outcome.body;
    if (!result.ok || !result.description) {
      toast(`Hermes could not write a description: ${result.reason ?? 'no reason given'}.`, { tone: 'warning' });
      return;
    }
    setProposal({ text: result.description, previous: card.description });
    await reload();
  };

  return (
    <div className="panel panel--pad pf-box">
      <div className="pf-box__head">
        <h3>About</h3>
        {card.descriptionAuto && (
          <span className="tag pf-auto" title="Written by Hermes’s model">
            <Icon name="bolt" small />
            Auto-described
          </span>
        )}
      </div>
      {editing ? (
        <div className="pf-desc">
          <label className="field__label" htmlFor="pf-description">
            Description
          </label>
          <textarea id="pf-description" className="input" rows={3} value={draft} onChange={(event) => setDraft(event.target.value)} />
          <p className="field__help">Kanban uses it to route tasks to the right profile. Hermes keeps it as yours, so Auto-describe will not overwrite it unless you ask.</p>
          <div className="row">
            <WriteButton type="button" className="btn btn--primary btn--sm" disabled={busy} aria-busy={busy} onClick={() => void save()}>
              Save
            </WriteButton>
            <button type="button" className="btn btn--secondary btn--sm" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="muted">{card.description || 'No description yet.'}</p>
          <div className="row">
            <WriteButton
              type="button"
              className="btn btn--secondary btn--sm"
              onClick={() => {
                setDraft(card.description);
                setEditing(true);
              }}
            >
              <Icon name="type" />
              Edit description
            </WriteButton>
            <WriteButton type="button" className="btn btn--secondary btn--sm" disabled={busy} aria-busy={busy} onClick={() => void describe()}>
              <Icon name="bolt" />
              {busy ? 'Asking Hermes…' : card.descriptionAuto ? 'Describe again' : 'Auto-describe'}
            </WriteButton>
          </div>
        </>
      )}
      {proposal && (
        <ProposalSheet
          card={card}
          proposal={proposal}
          onClose={() => setProposal(undefined)}
          reload={reload}
        />
      )}
    </div>
  );
}

/** What Hermes wrote: already saved, so Keep only closes; editing saves the new text as the owner's; Put back restores the old one. */
function ProposalSheet({ card, proposal, onClose, reload }: { card: ProfileCard; proposal: { text: string; previous: string }; onClose(): void; reload(): Promise<void> }) {
  const [text, setText] = useState(proposal.text);
  const [busy, setBusy] = useState(false);
  const edited = text.trim() !== proposal.text;
  const put = async (description: string, message: string) => {
    setBusy(true);
    const outcome = await saveDescription(card.name, description);
    setBusy(false);
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    if (outcome.kind !== 'done') return;
    toast(message, { tone: 'info' });
    await reload();
    onClose();
  };
  return (
    <Sheet
      title="Hermes suggests a description"
      initialFocus="textarea"
      onClose={onClose}
      footer={
        <div className="row">
          {edited ? (
            <WriteButton type="button" className="btn btn--primary" disabled={busy} onClick={() => void put(text, 'Description saved')}>
              Save my edit
            </WriteButton>
          ) : (
            <button type="button" className="btn btn--primary" onClick={onClose}>
              Keep it
            </button>
          )}
          <WriteButton type="button" className="btn btn--secondary" disabled={busy} onClick={() => void put(proposal.previous, 'Put the earlier description back')}>
            Put the old text back
          </WriteButton>
        </div>
      }
    >
      <div className="stack">
        <p className="muted">Hermes has already saved this as the description. Edit it, keep it, or put back {proposal.previous ? 'the text it replaced' : 'the empty description'}.</p>
        <label className="field__label" htmlFor="pf-proposal">
          Suggested description
        </label>
        <textarea id="pf-proposal" className="input" rows={4} value={text} onChange={(event) => setText(event.target.value)} />
      </div>
    </Sheet>
  );
}

/** Agents › Profiles › a profile's Overview: counts, performance, who it is, where it runs. */
export function Overview({ card, view }: TabProps) {
  const { overview, reload: reloadNumbers } = useOverview(card);
  const metrics = overview?.metrics;
  const percent = metrics ? Math.round(metrics.successRate * 100) : 0;
  const status = view.statuses[card.name];

  return (
    <div className="pf-ov">
      {overview && overview.missing.length > 0 && (
        <p className="banner pf-missing" data-tone="warning" role="status">
          <Icon name="alert" />
          <span className="banner__content">Hermes did not answer for {overview.missing.join(', ')}, so those numbers show as zero.</span>
          <button type="button" className="btn btn--secondary btn--sm" onClick={reloadNumbers}>
            <Icon name="refresh" />
            Retry
          </button>
        </p>
      )}
      {overview && overview.unavailable.length > 0 && (
        <p className="help-text pf-missing">
          <Icon name="info" small /> This Hermes has no {overview.unavailable.join(', ')}, so those numbers show as zero.
        </p>
      )}
      <div className="pf-stats" aria-busy={!metrics}>
        <Stat label="Sessions · 30 days" value={metrics ? number.format(metrics.sessions) : '…'} />
        <Stat label="Runs" value={metrics ? number.format(metrics.runs) : '…'} />
        <Stat label="Success rate" value={metrics ? `${percent}%` : '…'}>
          {metrics && metrics.runs > 0 && (
            <div className="progress" data-tone={percent >= 90 ? 'success' : 'warning'} role="img" aria-label={`${percent}% of finished runs succeeded`}>
              <i style={{ '--p': `${percent}%` } as CSSProperties} />
            </div>
          )}
        </Stat>
        <Stat label="Tokens · 30 days" value={metrics ? number.format(metrics.tokens) : '…'} />
        <Stat label="Skills" value={metrics ? number.format(metrics.skills) : number.format(card.skillCount)} />
        <Stat label="MCP servers" value={metrics ? number.format(metrics.mcpServers) : '…'} />
      </div>
      <p className="help-text">
        Runs are Kanban tasks assigned to this profile that have started; the success rate is the share of those that finished that are done rather than blocked. Everything here is asked of Hermes each time and kept nowhere else.
      </p>
      <div className="pf-ov__grid">
        <About card={card} reload={view.reload} />
        <div className="panel panel--pad pf-box">
          <div className="pf-box__head">
            <h3>Gateway</h3>
            <GatewayBadge card={card} status={status} />
          </div>
          <p className="muted">
            {(status?.gateway_running ?? card.gatewayRunning) ? 'Hermes’s messaging gateway is running for this profile.' : 'No messaging gateway is running for this profile. Chats from Caduceus and the command line still work.'} This is the{' '}
            <Term id="gateway-status">gateway status</Term> Hermes reports.
          </p>
          <div className="row">
            <AppLink className="btn btn--secondary btn--sm" to={`/connect/gateway?profile=${encodeURIComponent(card.name)}`}>
              <Icon name="broadcast" />
              Open Gateway
            </AppLink>
            <AppLink className="btn btn--secondary btn--sm" to={`/connect/channels?profile=${encodeURIComponent(card.name)}`}>
              <Icon name="plug" />
              Channels
            </AppLink>
          </div>
        </div>
        <div className="panel panel--pad pf-box">
          <div className="pf-box__head">
            <h3>Model</h3>
          </div>
          <dl className="kv">
            <dt>main</dt>
            <dd className="mono">{card.model ?? 'not set'}</dd>
            <dt>provider</dt>
            <dd className="mono">{card.provider ?? 'not set'}</dd>
          </dl>
        </div>
      </div>
    </div>
  );
}
