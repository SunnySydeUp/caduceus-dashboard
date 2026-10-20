// System › Plugins › Installed: the agent plugins Hermes lists, with the state Hermes holds. Plugins installed from git or the catalogue come
// first, and the ones that ship with Hermes after them. Turning a plugin on or off and removing it are Tier 1, installing and updating Tier 3.
import { useMemo, useState } from 'react';
import { Icon } from '../../icons.tsx';
import { StatusBadge, type StatusState } from '../../shell/StatusBadge.tsx';
import { toast } from '../../shell/toasts.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { removePlugin, setPluginEnabled, updatePlugin } from './plugin-actions.ts';
import type { PluginRow, PluginState } from './plugins-model.ts';
import './plugins.css';

const STATE: Record<PluginState, { state: StatusState; label: string }> = {
  enabled: { state: 'online', label: 'Enabled' },
  disabled: { state: 'paused', label: 'Disabled' },
  inactive: { state: 'queued', label: 'Not turned on' },
};

/** How many of the built-in plugins show before the owner asks for all of them: there are dozens, and they are rarely what is looked for. */
const BUILT_IN_SHOWN = 6;

const matches = (words: readonly string[], plugin: PluginRow) => words.every((word) => `${plugin.name} ${plugin.description}`.toLowerCase().includes(word));

function PluginCard({ plugin, busy, onToggle, onUpdate, onRemove }: { plugin: PluginRow; busy: boolean; onToggle(): void; onUpdate(): void; onRemove(): void }) {
  const standing = STATE[plugin.state];
  return (
    <li className="pl-card" data-plugin={plugin.name}>
      <div className="pl-card__top">
        <div className="pl-card__id">
          <h3 className="pl-card__name">{plugin.name}</h3>
          <p className="pl-card__sub">
            {plugin.version ? `Version ${plugin.version} · ` : ''}
            {plugin.source === 'bundled' ? 'Ships with Hermes' : 'Installed'}
          </p>
        </div>
        <StatusBadge state={standing.state} label={standing.label} variant="plain" />
      </div>
      {plugin.description && <p className="pl-card__desc">{plugin.description}</p>}
      {plugin.withdrawn !== undefined && (
        <p className="pl-warn">
          <Icon name="alert" small /> The catalogue withdrew this plugin: {plugin.withdrawn}
        </p>
      )}
      {plugin.authCommand && (
        <p className="pl-note">
          Its tools need a sign-in. On the Mac that runs Hermes, run <code className="pl-code">{plugin.authCommand}</code>.
        </p>
      )}
      <div className="pl-card__actions">
        <WriteButton type="button" className="btn btn--secondary btn--sm" disabled={busy} aria-busy={busy} aria-label={`${plugin.state === 'enabled' ? 'Turn off' : 'Turn on'} ${plugin.name}`} onClick={onToggle}>
          {plugin.state === 'enabled' ? 'Turn off' : 'Turn on'}
        </WriteButton>
        {plugin.updatable && (
          <WriteButton type="button" className="btn btn--secondary btn--sm" disabled={busy} aria-label={`Update ${plugin.name}`} onClick={onUpdate}>
            <Icon name="refresh" small />
            Update
          </WriteButton>
        )}
        {plugin.removable && (
          <WriteButton type="button" className="btn btn--ghost btn--sm pl-danger" disabled={busy} aria-label={`Remove ${plugin.name}`} onClick={onRemove}>
            <Icon name="trash" small />
            Remove
          </WriteButton>
        )}
      </div>
    </li>
  );
}

export interface InstalledProps {
  plugins: readonly PluginRow[];
  /** Asks Hermes for the list again. */
  reload(): Promise<void>;
  onBrowse(): void;
  onInstall(): void;
  /** Opens the log of an update that was started. */
  onUpdateStarted(started: { id: string; title: string }): void;
}

export function Installed({ plugins, reload, onBrowse, onInstall, onUpdateStarted }: InstalledProps) {
  const [query, setQuery] = useState('');
  const [working, setWorking] = useState<string>();
  const [allBuiltIn, setAllBuiltIn] = useState(false);
  const words = useMemo(() => query.toLowerCase().split(/\s+/).filter(Boolean), [query]);
  const mine = plugins.filter((plugin) => plugin.source === 'user' && matches(words, plugin));
  const builtIn = plugins.filter((plugin) => plugin.source === 'bundled' && matches(words, plugin));
  const anyOfMine = plugins.some((plugin) => plugin.source === 'user');
  const shownBuiltIn = allBuiltIn || words.length > 0 ? builtIn : builtIn.slice(0, BUILT_IN_SHOWN);

  const act = async (plugin: PluginRow, run: () => Promise<{ kind: 'done' | 'cancelled' | 'failed'; message?: string }>, done: string) => {
    setWorking(plugin.name);
    const outcome = await run();
    setWorking(undefined);
    if (outcome.kind === 'failed') toast(outcome.message ?? 'Hermes could not do that.', { tone: 'danger' });
    if (outcome.kind === 'done') {
      toast(done, { detail: 'A gateway loads plugins when it starts. Restart it to apply this.' });
      await reload();
    }
  };

  const update = async (plugin: PluginRow) => {
    setWorking(plugin.name);
    const outcome = await updatePlugin(plugin);
    setWorking(undefined);
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    if (outcome.kind === 'done') onUpdateStarted({ id: outcome.body.id, title: `Update ${plugin.name}` });
  };

  const toggle = (plugin: PluginRow) => {
    const enabling = plugin.state !== 'enabled';
    return act(plugin, () => setPluginEnabled(plugin, enabling), `${plugin.name} turned ${enabling ? 'on' : 'off'}`);
  };

  return (
    <div className="pl-panel">
      <div className="pl-bar">
        <div className="input-wrap pl-search" role="search">
          <Icon name="search" />
          <input type="search" className="input" placeholder="Search installed plugins" aria-label="Search installed plugins" autoComplete="off" spellCheck={false} value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
      </div>

      <section className="pl-section" aria-labelledby="pl-mine">
        <h2 className="pl-section__title" id="pl-mine">
          <Icon name="puzzle" />
          Installed by you
          <span className="pl-section__count">{mine.length}</span>
        </h2>
        {!anyOfMine ? (
          <div className="empty">
            <span className="empty__icon">
              <Icon name="puzzle" />
            </span>
            <p>No plugins are installed.</p>
            <p>Plugins add tools, hooks and integrations to Hermes. Pick one from the catalogue, or install one from a git address.</p>
            <div className="pl-actions">
              <button type="button" className="btn btn--primary" onClick={onBrowse}>
                <Icon name="package" />
                Browse catalogue
              </button>
              <WriteButton type="button" className="btn btn--secondary" onClick={onInstall}>
                <Icon name="download" />
                Install from git
              </WriteButton>
            </div>
          </div>
        ) : mine.length === 0 ? (
          <p className="pl-note">No installed plugin matches “{query.trim()}”.</p>
        ) : (
          <ul className="pl-cards" aria-label="Installed by you">
            {mine.map((plugin) => (
              <PluginCard key={plugin.name} plugin={plugin} busy={working === plugin.name} onToggle={() => void toggle(plugin)} onUpdate={() => void update(plugin)} onRemove={() => void act(plugin, () => removePlugin(plugin), `${plugin.name} removed`)} />
            ))}
          </ul>
        )}
      </section>

      {builtIn.length > 0 && (
        <section className="pl-section" aria-labelledby="pl-built-in">
          <h2 className="pl-section__title" id="pl-built-in">
            <Icon name="stack" />
            Built in
            <span className="pl-section__count">{builtIn.length}</span>
          </h2>
          <ul className="pl-cards" aria-label="Built in">
            {shownBuiltIn.map((plugin) => (
              <PluginCard key={plugin.name} plugin={plugin} busy={working === plugin.name} onToggle={() => void toggle(plugin)} onUpdate={() => undefined} onRemove={() => undefined} />
            ))}
          </ul>
          {!allBuiltIn && words.length === 0 && builtIn.length > BUILT_IN_SHOWN && (
            <button type="button" className="btn btn--secondary pl-more" onClick={() => setAllBuiltIn(true)}>
              Show all {builtIn.length} built-in plugins
            </button>
          )}
        </section>
      )}
    </div>
  );
}
