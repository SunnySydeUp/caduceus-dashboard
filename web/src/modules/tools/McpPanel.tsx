import { useId, useState } from 'react';
import { Icon } from '../../icons.tsx';
import { StatusBadge } from '../../shell/StatusBadge.tsx';
import { Term } from '../../shell/Term.tsx';
import { toast } from '../../shell/toasts.ts';
import { useSizeClass } from '../../shell/use-size-class.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { CaduceusMcpCard } from './CaduceusMcpCard.tsx';
import { addServer, saveServer, setServerEnabled } from './mcp-actions.ts';
import { useMcpServers } from './mcp-data.ts';
import { commandLine, emptyForm, formOf, statusOf, type McpServer } from './mcp-model.ts';
import { McpDetail } from './McpDetail.tsx';
import { McpServerSheet } from './McpServerSheet.tsx';
import './tools.css';

type Editing = { mode: 'add' } | { mode: 'edit'; name: string };

/** The profile's MCP servers: each with its status and an on/off switch, an Add button and a sheet for the detail. */
export function McpPanel({ profile }: { profile: string }) {
  const view = useMcpServers(profile);
  const compact = useSizeClass() === 'compact';
  const [open, setOpen] = useState<string>();
  const [editing, setEditing] = useState<Editing>();
  const [busy, setBusy] = useState<string>();
  const data = view.value;
  const opened = data?.servers.find((server) => server.name === open);
  const edited = editing?.mode === 'edit' ? data?.servers.find((server) => server.name === editing.name) : undefined;

  const toggle = async (server: McpServer) => {
    const enabled = !server.enabled;
    setBusy(server.name);
    const outcome = await setServerEnabled(server.name, enabled, profile);
    setBusy(undefined);
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    if (outcome.kind !== 'done') return;
    await view.reload();
    toast(`${server.name} switched ${enabled ? 'on' : 'off'} for ${profile}`, {
      detail: 'New sessions use it.',
      undo: () =>
        void setServerEnabled(server.name, !enabled, profile).then(async (undone) => {
          if (undone.kind === 'failed') toast(undone.message, { tone: 'danger' });
          await view.reload();
        }),
    });
  };

  const submitAdd = async (form: Parameters<typeof addServer>[0]) => {
    const outcome = await addServer(form, data?.definitions ?? {}, profile);
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    if (outcome.kind !== 'done') return false;
    toast(`Added ${form.name.trim()} to ${profile}`, { detail: 'Test it to see its tools.' });
    await view.reload();
    return true;
  };

  const submitEdit = async (name: string, form: Parameters<typeof addServer>[0]) => {
    const outcome = await saveServer(form, name, data?.definitions ?? {}, profile);
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    if (outcome.kind !== 'done') return false;
    toast(`Saved ${name} for ${profile}`, { detail: 'New sessions use it.' });
    await view.reload();
    return true;
  };

  const heading = useId();
  return (
    <div className="tl-panel">
      <p className="help-text">
        <Term id="mcp-server">MCP servers</Term> give the agents of <strong>{profile}</strong> more tools. These are the servers in the profile’s config, as Hermes reports them. A server loads when a session starts, so a change reaches new sessions; a chat that is already open keeps the tools it has.
      </p>
      {view.failed && (
        <div className="banner" data-tone="danger" role="alert">
          <Icon name="alert" />
          <span className="banner__content">Hermes did not answer, so its MCP servers could not be listed{data ? ': this is the list from a moment ago' : ''}.</span>
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => void view.reload()}>
            <Icon name="refresh" />
            Retry
          </button>
        </div>
      )}
      {!data && !view.failed && <p role="status">Loading MCP servers…</p>}
      {data && <CaduceusMcpCard profile={profile} servers={data.servers} definitions={data.definitions} reload={view.reload} />}
      {data && (
        <div className="tl-bar">
          <WriteButton type="button" className="btn btn--primary" onClick={() => setEditing({ mode: 'add' })}>
            <Icon name="plus" />
            Add a server…
          </WriteButton>
          <span id={heading} className="subtle" role="status">
            {data.servers.length === 0 ? 'No servers yet' : `${data.servers.filter((server) => server.enabled).length} of ${data.servers.length} on`}
          </span>
        </div>
      )}
      {data && data.servers.length > 0 && (
        <ul className="tl-cards" aria-label="MCP servers" data-layout={compact ? 'list' : 'grid'}>
          {data.servers.map((server) => {
            const status = statusOf(server, data.runtime?.get(server.name));
            return (
              <li className="tl-card" key={server.name} data-server={server.name}>
                <div className="tl-card__top">
                  <div className="tl-card__id">
                    <h3 className="tl-card__name">{server.name}</h3>
                    <span className="tl-card__key mono" data-clamp>{server.command ? commandLine(server.command, server.args) : (server.url ?? '')}</span>
                  </div>
                  <div className="tl-card__switch">
                    <WriteButton type="button" role="switch" className="switch" aria-checked={server.enabled} aria-label={`${server.name} on`} disabled={busy === server.name} onClick={() => void toggle(server)} />
                  </div>
                </div>
                <div className="tl-card__tags">
                  <StatusBadge state={status.state} label={status.label} variant="plain" />
                  <span className="tag">{server.transport === 'stdio' ? 'Command' : server.transport.toUpperCase()}</span>
                  {server.auth === 'oauth' && <span className="tag">OAuth</span>}
                </div>
                <div className="tl-card__actions">
                  <button type="button" className="btn btn--secondary btn--sm" aria-label={`Details of ${server.name}`} onClick={() => setOpen(server.name)}>
                    <Icon name="sliders" small />
                    Details
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {data && data.servers.length === 0 && (
        <div className="empty">
          <span className="empty__icon">
            <Icon name="plug" />
          </span>
          <p>This profile has no MCP servers. Add one, or install one from the Catalogue.</p>
        </div>
      )}
      {opened && data && <McpDetail key={`${profile}:${opened.name}`} server={opened} runtime={data.runtime?.get(opened.name)} profile={profile} reload={view.reload} onEdit={() => setEditing({ mode: 'edit', name: opened.name })} onClose={() => setOpen(undefined)} />}
      {editing?.mode === 'add' && data && <McpServerSheet mode="add" initial={emptyForm('http')} profile={profile} names={data.servers.map((server) => server.name)} onSubmit={submitAdd} onClose={() => setEditing(undefined)} />}
      {edited && data && (
        <McpServerSheet
          mode="edit"
          initial={formOf(edited, data.definitions[edited.name])}
          profile={profile}
          names={[]}
          keeps={edited.envNames}
          hadBearer={edited.auth === 'header'}
          onSubmit={(form) => submitEdit(edited.name, form)}
          onClose={() => setEditing(undefined)}
        />
      )}
    </div>
  );
}
