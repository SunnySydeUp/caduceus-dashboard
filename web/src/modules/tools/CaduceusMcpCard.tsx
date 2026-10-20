import { useId, useState } from 'react';
import { Icon } from '../../icons.tsx';
import { Term } from '../../shell/Term.tsx';
import { toast } from '../../shell/toasts.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { isRegistered, registrationCommand, registrationForm } from './caduceus-mcp.ts';
import { addServer } from './mcp-actions.ts';
import { useMcpServerInfo } from './mcp-data.ts';
import type { McpServer } from './mcp-model.ts';

/**
 * The Caduceus MCP server, explained: agents of the profile can list, create, rename and delete projects and move sessions through Caduceus.
 * It shows the exact registration command, and Add to this profile makes the same registration through the add flow (a stdio server, so a
 * Tier 3 confirmation that shows the command and asks for the name).
 */
export function CaduceusMcpCard({ profile, servers, definitions, reload }: { profile: string; servers: readonly McpServer[]; definitions: Readonly<Record<string, Record<string, unknown>>>; reload(): Promise<void> }) {
  const view = useMcpServerInfo(profile);
  const [busy, setBusy] = useState(false);
  const heading = useId();
  const info = view.value;
  if (!info) return null;
  const command = registrationCommand(info, profile);
  const registered = isRegistered(info, servers);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      toast('Copied the registration command', { tone: 'info' });
    } catch {
      toast('This browser would not copy. Select the command on the card and copy it.', { tone: 'warning' });
    }
  };

  const add = async () => {
    setBusy(true);
    const outcome = await addServer(registrationForm(info), definitions, profile);
    setBusy(false);
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    if (outcome.kind !== 'done') return;
    toast(`Added ${info.name} to ${profile}`, { detail: 'New sessions of the profile have its tools. Test it to see them.' });
    await reload();
  };

  return (
    <section className="tl-card tl-caduceus" aria-labelledby={heading} data-testid="caduceus-mcp-card">
      <div className="tl-card__top">
        <div className="tl-card__id">
          <h3 className="tl-card__name" id={heading}>
            Caduceus as an MCP server
          </h3>
          <span className="tl-card__key">Lets an agent manage projects and sessions through Caduceus</span>
        </div>
      </div>
      <p className="tl-card__desc">
        Add this <Term id="caduceus-mcp-server">MCP server</Term> to a profile and its agents can list, create, rename and delete Hermes projects, and list, rename and move sessions. Every call goes through Caduceus: <Term id="risk-tiers">risk tiers</Term>, <Term id="read-only-mode">read-only mode</Term> and the audit log apply as they do here. Deleting a project needs your passkey, which an agent cannot give, so it is refused. Caduceus keeps nothing new: the projects and sessions are Hermes’s.
      </p>
      <pre className="tl-code tl-command" tabIndex={0} aria-label={`Registration command for ${profile}`}>{command}</pre>
      <div className="tl-card__actions">
        <WriteButton type="button" className="btn btn--primary btn--sm" disabled={busy || registered} onClick={() => void add()}>
          <Icon name="plus" small />
          {registered ? `Added to ${profile}` : 'Add to this profile'}
        </WriteButton>
        <button type="button" className="btn btn--secondary btn--sm" onClick={() => void copy()}>
          <Icon name="copy" small />
          Copy command
        </button>
      </div>
      <details className="tl-tools">
        <summary>Tools ({info.tools.length})</summary>
        <ul className="tl-tools__list">
          {info.tools.map((tool) => (
            <li key={tool.name}>
              <span className="mono">{tool.name}</span>
              <span className="subtle">{tool.readOnly ? ' (read)' : ' (change)'}</span>
              <span className="tl-card__desc"> {tool.description}</span>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
