import { useState } from 'react';
import { Icon } from '../../icons.tsx';
import { StatusBadge, type StatusState } from '../../shell/StatusBadge.tsx';
import { Term } from '../../shell/Term.tsx';
import { toast } from '../../shell/toasts.ts';
import { useSizeClass } from '../../shell/use-size-class.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { chooseProvider } from './memory-actions.ts';
import { useMemoryStatus } from './memory-data.ts';
import type { MemoryProvider } from './memory-model.ts';
import { ProviderSheet } from './ProviderSheet.tsx';
import './memory.css';

const STATUS_WORDS: Record<string, { state: StatusState; label: string }> = {
  ready: { state: 'online', label: 'Ready' },
  needs_config: { state: 'degraded', label: 'Needs settings' },
  unavailable: { state: 'offline', label: 'Not installed' },
};

/** The profile's memory providers: Hermes's list with each one's status, a way to choose it and its settings. */
export function ProviderPanel({ profile }: { profile: string }) {
  const view = useMemoryStatus(profile);
  const compact = useSizeClass() === 'compact';
  const [configuring, setConfiguring] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const status = view.value;
  const configured = status?.providers.find((provider) => provider.name === configuring);

  const choose = async (provider: MemoryProvider | undefined) => {
    setBusy(provider?.name ?? '');
    const outcome = await chooseProvider(provider, profile);
    setBusy(undefined);
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    if (outcome.kind !== 'done') return;
    await view.reload();
    toast(provider ? `${provider.name} is the memory provider of ${profile}` : `${profile} uses the built-in memory`, { detail: 'New sessions use it.' });
  };

  return (
    <div className="mm-panel">
      <p className="help-text">
        A <Term id="memory-provider">memory provider</Term> remembers things across sessions, besides the built-in <Term id="memory-md">MEMORY.md</Term> and <Term id="user-md">USER.md</Term>. Only one can be active for <strong>{profile}</strong>. The list and every form below are Hermes’s own, read each time you look.
      </p>
      {view.failed && (
        <div className="banner" data-tone="danger" role="alert">
          <Icon name="alert" />
          <span className="banner__content">Hermes did not answer, so its memory providers could not be listed{status ? ': this is the list from a moment ago' : ''}.</span>
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => void view.reload()}>
            <Icon name="refresh" />
            Retry
          </button>
        </div>
      )}
      {!status && !view.failed && <p role="status">Loading memory providers…</p>}
      {status && (
        <ul className="mm-cards" aria-label="Memory providers" data-layout={compact ? 'list' : 'grid'}>
          <li className="mm-card" data-active={status.active === ''} data-provider="">
            <h3 className="mm-card__name">Built-in memory</h3>
            <p className="mm-card__desc">MEMORY.md and USER.md only, with no outside provider.</p>
            <div className="mm-card__tags">{status.active === '' && <span className="tag" data-tone="accent">Active</span>}</div>
            <div className="mm-card__actions">
              {status.active !== '' && (
                <WriteButton type="button" className="btn btn--secondary btn--sm" disabled={busy !== undefined} aria-busy={busy === ''} onClick={() => void choose(undefined)}>
                  Use built-in memory…
                </WriteButton>
              )}
            </div>
          </li>
          {status.providers.map((provider) => {
            const words = STATUS_WORDS[provider.status] ?? { state: 'offline' as const, label: provider.status || 'Unknown' };
            const active = status.active === provider.name;
            return (
              <li className="mm-card" key={provider.name} data-active={active} data-provider={provider.name}>
                <h3 className="mm-card__name">{provider.name}</h3>
                <p className="mm-card__desc">{provider.description}</p>
                <div className="mm-card__tags">
                  <StatusBadge state={words.state} label={words.label} variant="plain" />
                  {active && <span className="tag" data-tone="accent">Active</span>}
                </div>
                <div className="mm-card__actions">
                  {!active && provider.status === 'ready' && (
                    <WriteButton type="button" className="btn btn--primary btn--sm" aria-label={`Use ${provider.name}`} disabled={busy !== undefined} aria-busy={busy === provider.name} onClick={() => void choose(provider)}>
                      Use…
                    </WriteButton>
                  )}
                  <button type="button" className="btn btn--secondary btn--sm" aria-label={`Settings of ${provider.name}`} onClick={() => setConfiguring(provider.name)}>
                    <Icon name="sliders" small />
                    Settings
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {status && status.providers.length === 0 && (
        <div className="empty">
          <span className="empty__icon">
            <Icon name="database" />
          </span>
          <p>Hermes lists no memory providers. Its built-in memory is in use.</p>
        </div>
      )}
      {configured && <ProviderSheet key={`${profile}:${configured.name}`} provider={configured} profile={profile} reload={view.reload} onClose={() => setConfiguring(undefined)} />}
    </div>
  );
}
