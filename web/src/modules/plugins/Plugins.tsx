// System › Plugins: the agent plugins Hermes lists (enable, disable, update, remove), installing from a git address or from Hermes's catalogue, and the
// live log of an install or update. Hermes holds the plugins and their state; this page keeps nothing of them.
import { useState } from 'react';
import { Icon } from '../../icons.tsx';
import { AppLink, useAppNavigate } from '../../shell/navigation.tsx';
import { PageHeader } from '../../shell/PageHeader.tsx';
import { Term } from '../../shell/Term.tsx';
import { toast } from '../../shell/toasts.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import '../profiles/profiles.css';
import { CataloguePanel } from './CataloguePanel.tsx';
import { InstallSheet } from './InstallSheet.tsx';
import { Installed } from './Installed.tsx';
import { OperationLogSheet } from './OperationLogSheet.tsx';
import { raisePluginRestart } from './plugin-actions.ts';
import { useCatalogue, usePlugins } from './plugins-data.ts';
import type { CatalogueEntry, OperationState } from './plugins-model.ts';
import './plugins.css';

type Tab = 'installed' | 'catalogue';

const TABS = [
  { id: 'installed', label: 'Installed', icon: 'puzzle', path: '/system/plugins' },
  { id: 'catalogue', label: 'Catalogue', icon: 'package', path: '/system/plugins/catalogue' },
] as const;

/** What a sheet is open for: the install form (for a catalogue entry, or for an address typed), or the log of an operation that was started. */
type Layer = { kind: 'install'; entry?: CatalogueEntry } | { kind: 'log'; id: string; title: string; reason: string };

function PluginsPage({ tab }: { tab: Tab }) {
  const plugins = usePlugins();
  const catalogue = useCatalogue();
  const [layer, setLayer] = useState<Layer>();
  const navigate = useAppNavigate();
  const go = TABS.find((candidate) => candidate.id === tab)!;

  const finished = async (title: string, reason: string, state: OperationState) => {
    // The list is read again the moment the command ends, whichever way it ended: a failed install can still have changed what is there.
    await Promise.all([plugins.reload(), catalogue.reload()]);
    if (state.status === 'ok') {
      toast(`${title}: done`, { detail: 'A gateway loads plugins when it starts. Restart it to apply this.' });
      await raisePluginRestart(reason);
    }
  };

  return (
    <div className="pf pl">
      <PageHeader
        overline="System"
        title="Plugins"
        subtitle={<span className="subtle">{plugins.value ? `${plugins.value.filter((plugin) => plugin.source === 'user').length} installed by you · ${plugins.value.filter((plugin) => plugin.source === 'bundled').length} built in` : 'Hermes’s agent plugins'}</span>}
        actions={
          <WriteButton type="button" className="btn btn--primary" onClick={() => setLayer({ kind: 'install' })}>
            <Icon name="plus" />
            Install plugin
          </WriteButton>
        }
      />
      <p className="help-text">
        A <Term id="plugin">plugin</Term> adds tools, hooks or integrations to Hermes. Hermes keeps the list and whether each is on; this page asks it each time. Installing or updating one runs its code on this Mac, so it is a <Term id="risk-tiers">Tier 3</Term> action.
      </p>
      {plugins.failed && (
        <div className="banner" data-tone="danger" role="alert">
          <Icon name="alert" />
          <span className="banner__content">Hermes did not give its plugins{plugins.value ? ': what shows is from a moment ago' : ''}.</span>
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => void plugins.reload()}>
            <Icon name="refresh" />
            Retry
          </button>
        </div>
      )}
      <div className="pf-body">
        <nav className="pf-tabs" aria-label="Plugins sections">
          <ul>
            {TABS.map((candidate) => (
              <li key={candidate.id}>
                <AppLink to={candidate.path} aria-current={candidate.id === tab ? 'page' : undefined}>
                  <Icon name={candidate.icon} small />
                  <span>{candidate.label}</span>
                </AppLink>
              </li>
            ))}
          </ul>
        </nav>
        <section className="pf-panel" aria-labelledby="pl-tab-title">
          <h2 id="pl-tab-title" className="pf-panel__title">
            {go.label}
          </h2>
          {tab === 'installed' ? (
            plugins.value ? (
              <Installed plugins={plugins.value} reload={plugins.reload} onBrowse={() => void navigate('/system/plugins/catalogue')} onInstall={() => setLayer({ kind: 'install' })} onUpdateStarted={({ id, title }) => setLayer({ kind: 'log', id, title, reason: `${title.replace('Update ', 'Plugin ')} updated` })} />
            ) : (
              !plugins.failed && <p role="status">Loading plugins…</p>
            )
          ) : (
            <CataloguePanel catalogue={catalogue.value} failed={catalogue.failed} retry={() => void catalogue.reload()} onInstall={(entry) => setLayer({ kind: 'install', entry })} />
          )}
        </section>
      </div>

      {layer?.kind === 'install' && <InstallSheet entry={layer.entry} onStarted={({ id, title }) => setLayer({ kind: 'log', id, title, reason: layer.entry ? `Plugin ${layer.entry.name} installed` : 'A plugin was installed' })} onClose={() => setLayer(undefined)} />}
      {layer?.kind === 'log' && <OperationLogSheet id={layer.id} title={layer.title} onFinished={(state) => void finished(layer.title, layer.reason, state)} onClose={() => setLayer(undefined)} />}
    </div>
  );
}

export const InstalledScreen = () => <PluginsPage tab="installed" />;
export const CatalogueScreen = () => <PluginsPage tab="catalogue" />;
