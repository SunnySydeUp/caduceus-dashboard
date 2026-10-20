// The changes Agents › Tools & MCP › MCP servers makes in Hermes, each through `fetchTiered` with the tier the policy map gives the
// request (on and off T0, delete T1, a test and a sign-in T1, an HTTP or SSE server T2, a stdio server and a catalogue install T3).
// The caller shows toasts and reloads; this says what happened. A Bearer token or a variable's value goes to Hermes and nowhere else:
// no confirmation, toast or message here ever has one. Caduceus keeps nothing of what it sends.
import { fetchTiered } from '../../tiered.ts';
import { runTiered, type ActionOutcome } from '../profiles/profile-actions.ts';
import { catalogInstall, commandLine, oauthCallbackPath, oauthCancel, parseOauthFlow, parseProbe, serverAuth, serverCreate, serverEdit, serverEnabled, serverRemove, serverTest, sseCreate, type CatalogEntry, type McpRequest, type McpServer, type OauthFlow, type Probe, type ServerForm } from './mcp-model.ts';

const stdioText = (form: ServerForm) => `Hermes will start this program on this computer whenever a session uses the server, with the access of your account: ${commandLine(form.command.trim(), form.args.split('\n').filter((line) => line.trim() !== ''))}`;

/** Adds a server (HTTP or SSE T2, stdio T3 with its exact command line in the confirmation). */
export function addServer(form: ServerForm, definitions: Readonly<Record<string, Record<string, unknown>>>, profile: string): Promise<ActionOutcome> {
  const name = form.name.trim();
  const request: McpRequest = form.transport === 'sse' ? sseCreate(form, definitions, profile) : serverCreate(form, profile);
  const stdio = form.transport === 'stdio';
  return runTiered(
    fetchTiered({
      ...request,
      confirm: {
        title: `Add the ${stdio ? 'stdio' : form.transport.toUpperCase()} server ${name} to ${profile}?`,
        text: stdio ? stdioText(form) : `Hermes saves ${name} (${form.url.trim()}) to the profile’s config. It connects only when a session starts or you test it.`,
        object: name,
        profile,
        confirmLabel: 'Add server',
        recoverability: { undoable: true, note: 'Delete the server to take it out again.' },
      },
    }),
  );
}

/** Saves an edit. Hermes replaces the whole map, so this is Tier 3 while any server in the profile is stdio: the confirmation then shows the command line of the one being edited, or says the map holds a program. */
export function saveServer(form: ServerForm, name: string, definitions: Readonly<Record<string, Record<string, unknown>>>, profile: string): Promise<ActionOutcome> {
  const request = serverEdit(form, name, definitions, profile);
  const stdio = form.transport === 'stdio';
  return runTiered(
    fetchTiered({
      ...request,
      confirm: {
        title: `Save the changes to ${name} for ${profile}?`,
        text: stdio ? stdioText(form) : `Hermes saves the new address of ${name}. Everything else about the server stays as it is. A chat that is already open keeps the tools it has.`,
        object: name,
        profile,
        confirmLabel: 'Save changes',
        recoverability: { undoable: true, note: 'Edit the server again to put the old values back.' },
      },
    }),
  );
}

/** Switches a server on or off (T0: no dialog; the toast offers the undo). */
export function setServerEnabled(name: string, enabled: boolean, profile: string): Promise<ActionOutcome> {
  return runTiered(fetchTiered(serverEnabled(name, enabled, profile)));
}

/** Deletes a server from the profile's config (T1: the dialog names the server and the profile). */
export function deleteServer(name: string, profile: string): Promise<ActionOutcome> {
  return runTiered(
    fetchTiered({
      ...serverRemove(name, profile),
      confirm: { title: `Delete the MCP server ${name} from ${profile}?`, text: 'Hermes removes it from the profile’s config. Its tools go from new sessions. Variables it kept in the .env file stay there.', object: name, profile, confirmLabel: 'Delete server' },
    }),
  );
}

/** Tests a server (T1, a read): Hermes connects, lists its tools and disconnects. A stdio server's program is started for it. */
export async function probeServer(server: McpServer, profile: string): Promise<ActionOutcome<Probe>> {
  const outcome = await runTiered(
    fetchTiered({
      ...serverTest(server.name, profile),
      confirm: {
        title: `Test ${server.name}?`,
        text: server.command ? `Hermes starts ${commandLine(server.command, server.args)}, asks it for its tools and stops it.` : `Hermes connects to ${server.url ?? server.name}, asks it for its tools and disconnects.`,
        object: server.name,
        profile,
        confirmLabel: 'Test server',
      },
    }),
  );
  return outcome.kind === 'done' ? { kind: 'done', body: parseProbe(outcome.body) } : outcome;
}

/** Starts Hermes's MCP sign-in (T1). The flow it answers with says where to sign in. */
export async function startSignIn(server: McpServer, profile: string): Promise<ActionOutcome<OauthFlow>> {
  const outcome = await runTiered(
    fetchTiered({
      ...serverAuth(server.name, profile),
      confirm: { title: `Sign in to ${server.name}?`, text: 'Hermes starts the server’s OAuth sign-in. You then sign in on the provider’s own page; Caduceus never sees your password.', object: server.name, profile, confirmLabel: 'Start sign-in' },
    }),
  );
  return outcome.kind === 'done' ? { kind: 'done', body: parseOauthFlow(outcome.body) } : outcome;
}

/** Ends a sign-in flow (T0). */
export function cancelSignIn(flow: OauthFlow): Promise<ActionOutcome> {
  return runTiered(fetchTiered(oauthCancel(flow.id)));
}

/** Hands the provider's redirect, pasted from the address bar, to Hermes (T1). */
export async function relaySignIn(pasted: string, server: McpServer, profile: string): Promise<ActionOutcome> {
  const relay = oauthCallbackPath(pasted, server.name);
  if ('problem' in relay) return { kind: 'failed', message: relay.problem };
  return runTiered(
    fetchTiered({
      method: 'GET',
      path: relay.path,
      confirm: { title: `Hand the sign-in of ${server.name} to Hermes?`, text: 'Hermes finishes the sign-in with the code from the address you pasted.', object: server.name, profile, confirmLabel: 'Hand it over' },
    }),
  );
}

/** Installs a catalogue entry (T3: the entry's name is typed). Values go to Hermes, which keeps secrets in the profile's .env; an entry that must be built runs as a background action whose name comes back. */
export async function installEntry(entry: CatalogEntry, values: Readonly<Record<string, string>>, profile: string): Promise<ActionOutcome<{ background: boolean; action: string | undefined }>> {
  const outcome = await runTiered<{ background?: unknown; action?: unknown }>(
    fetchTiered({
      ...catalogInstall(entry, values, profile),
      confirm: {
        title: `Install ${entry.name} for ${profile}?`,
        text: entry.command
          ? `Hermes adds ${entry.name} to the profile’s config. It will start ${commandLine(entry.command, entry.args)} on this computer.${entry.installUrl ? ` It first downloads and builds ${entry.installUrl}.` : ''}`
          : `Hermes adds ${entry.name} (${entry.url ?? 'a remote server'}) to the profile’s config.${entry.requiredEnv.length ? ' Values you typed are kept by Hermes, never shown again.' : ''}`,
        object: entry.name,
        profile,
        confirmLabel: 'Install',
        recoverability: { undoable: true, note: 'Delete the server to take it out again.' },
      },
    }),
  );
  if (outcome.kind !== 'done') return outcome;
  return { kind: 'done', body: { background: outcome.body.background === true, action: typeof outcome.body.action === 'string' ? outcome.body.action : undefined } };
}
