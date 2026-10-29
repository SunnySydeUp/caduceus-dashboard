import { useId, useMemo, useState } from 'react';
import { Icon } from '../../icons.tsx';
import { Loading } from '../../shell/Loading.tsx';
import { RadioGroup } from '../../shell/RadioGroup.tsx';
import { StatusBadge } from '../../shell/StatusBadge.tsx';
import { Term } from '../../shell/Term.tsx';
import { toast } from '../../shell/toasts.ts';
import { useSizeClass } from '../../shell/use-size-class.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { ActionLogSheet, type LogRun, type LogVerdict } from '../skills/ActionLogSheet.tsx';
import { judgeSetup, setToolsetEnabled } from './tools-actions.ts';
import { useToolsets } from './tools-data.ts';
import { filterToolsets, SETUP_ACTION, type Toolset, type ToolsetFilter } from './tools-model.ts';
import { ToolsetDrawer } from './ToolsetDrawer.tsx';
import './tools.css';

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'on', label: 'On' },
  { value: 'off', label: 'Off' },
  { value: 'needs-keys', label: 'Needs keys' },
] as const satisfies readonly { value: ToolsetFilter; label: string }[];

function ToolsetCard({ toolset, busy, onConfigure, onToggle }: { toolset: Toolset; busy: boolean; onConfigure(): void; onToggle(): void }) {
  const switchLabel = useId();
  return (
    <li className="tl-card" data-toolset={toolset.name}>
      <div className="tl-card__top">
        <div className="tl-card__id">
          <h3 className="tl-card__name">{toolset.label}</h3>
          <span className="tl-card__key mono">{toolset.name}</span>
        </div>
        <div className="tl-card__switch">
          <span id={switchLabel} className="sr-only">
            {toolset.label}
          </span>
          <WriteButton type="button" role="switch" className="switch" aria-checked={toolset.enabled} aria-labelledby={switchLabel} disabled={busy} onClick={onToggle} />
        </div>
      </div>
      <div className="tl-card__tags">
        {toolset.setup === 'ready' ? <StatusBadge state="succeeded" label="Ready" variant="plain" /> : <StatusBadge state="blocked" label="Needs keys" variant="plain" />}
        <span className="subtle">
          {toolset.tools.length} {toolset.tools.length === 1 ? 'tool' : 'tools'}
        </span>
        {toolset.platform !== 'cli' && <span className="tag">Only on {toolset.platformLabel}</span>}
      </div>
      {toolset.description && <p className="tl-card__desc">{toolset.description}</p>}
      <div className="tl-card__actions">
        <button type="button" className={`btn btn--sm ${toolset.setup === 'needs-keys' ? 'btn--primary' : 'btn--secondary'}`} aria-label={`Configure ${toolset.label}`} onClick={onConfigure}>
          <Icon name="sliders" small />
          Configure
        </button>
      </div>
    </li>
  );
}

/** The grid of a profile's toolsets (a list on a phone), with their on and off switches, the setup state of each and the configure panel. */
export function ToolsetsPanel({ profile }: { profile: string }) {
  const view = useToolsets(profile);
  const compact = useSizeClass() === 'compact';
  const [query, setQuery] = useState('');
  const [show, setShow] = useState<ToolsetFilter>('all');
  const [open, setOpen] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const [install, setInstall] = useState<LogRun>();
  const filterLabel = useId();

  const toolsets = view.value;
  const shown = useMemo(() => (toolsets ? filterToolsets(toolsets, { query, show }) : undefined), [toolsets, query, show]);
  const opened = toolsets?.find((toolset) => toolset.name === open);
  const on = toolsets?.filter((toolset) => toolset.enabled).length ?? 0;

  const toggle = async (toolset: Toolset) => {
    setBusy(toolset.name);
    const outcome = await setToolsetEnabled(toolset, profile, !toolset.enabled);
    setBusy(undefined);
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    if (outcome.kind !== 'done') return;
    toast(`${toolset.label} ${toolset.enabled ? 'switched off' : 'switched on'} for ${profile}`, { detail: 'New sessions use it.' });
    if (outcome.body.installStarted) {
      setInstall({ action: SETUP_ACTION, title: `Installing for ${toolset.label}`, doneTitle: `${toolset.label} is installed`, judge: judgeSetup });
    }
    await view.reload();
  };

  const finished = (verdict: LogVerdict) => {
    toast(verdict.ok ? (verdict.message ?? 'Setup finished.') : verdict.message, { tone: verdict.ok ? undefined : 'danger' });
    void view.reload();
  };

  return (
    <div className="tl-panel">
      <p className="help-text">
        A <Term id="toolset">toolset</Term> is a group of tools an agent can use, such as web search or the terminal. These are the toolsets of <strong>{profile}</strong>, as Hermes reports them. A switch changes new sessions; a chat that is already open keeps the tools it has.
      </p>
      {view.failed && (
        <div className="banner" data-tone="danger" role="alert">
          <Icon name="alert" />
          <span className="banner__content">Hermes did not answer, so its toolsets could not be listed{toolsets ? ': this is the list from a moment ago' : ''}.</span>
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => void view.reload()}>
            <Icon name="refresh" />
            Retry
          </button>
        </div>
      )}
      {!toolsets && !view.failed && <Loading label="Loading toolsets…" lines={5} onRetry={() => void view.reload()} />}
      {toolsets && toolsets.length > 0 && (
        <div className="tl-bar">
          <div className="input-wrap tl-search">
            <Icon name="search" />
            <input className="input" type="search" placeholder="Search toolsets" aria-label="Search toolsets" value={query} onChange={(event) => setQuery(event.target.value)} />
          </div>
          <span id={filterLabel} className="sr-only">
            Show
          </span>
          <RadioGroup labelledBy={filterLabel} value={show} options={FILTERS} onChange={setShow} className="seg" />
          <span className="subtle" role="status">
            {on} of {toolsets.length} on
          </span>
        </div>
      )}
      {shown && shown.length > 0 && (
        <ul className="tl-cards" aria-label="Toolsets" data-layout={compact ? 'list' : 'grid'}>
          {shown.map((toolset) => (
            <ToolsetCard key={toolset.name} toolset={toolset} busy={busy === toolset.name} onConfigure={() => setOpen(toolset.name)} onToggle={() => void toggle(toolset)} />
          ))}
        </ul>
      )}
      {toolsets && shown && shown.length === 0 && (
        <div className="empty">
          <span className="empty__icon">
            <Icon name="tool" />
          </span>
          <p>{toolsets.length === 0 ? 'Hermes lists no toolsets for this profile.' : 'No toolset matches.'}</p>
          {toolsets.length === 0 ? (
            <button type="button" className="btn btn--secondary" onClick={() => void view.reload()}>
              <Icon name="refresh" />
              Ask Hermes again
            </button>
          ) : (
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => {
                setQuery('');
                setShow('all');
              }}
            >
              Show every toolset
            </button>
          )}
        </div>
      )}
      {opened && <ToolsetDrawer key={`${profile}:${opened.name}`} toolset={opened} profile={profile} onClose={() => setOpen(undefined)} reload={view.reload} />}
      {install && <ActionLogSheet run={install} onFinished={finished} onClose={() => setInstall(undefined)} />}
    </div>
  );
}
