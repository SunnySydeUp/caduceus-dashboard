import { useState } from 'react';
import { Icon } from '../../icons.tsx';
import { Sheet } from '../../overlays/Sheet.tsx';
import { StatusBadge } from '../../shell/StatusBadge.tsx';
import { Term } from '../../shell/Term.tsx';
import { toast } from '../../shell/toasts.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { deleteServer, probeServer, startSignIn } from './mcp-actions.ts';
import { commandLine, filterWords, statusOf, type McpServer, type OauthFlow, type Probe, type RuntimeState } from './mcp-model.ts';
import { McpSignIn } from './McpSignIn.tsx';

const TRANSPORT_WORDS = { stdio: 'Command (stdio)', http: 'HTTP', sse: 'SSE', unknown: 'Unknown' } as const;
const AUTH_WORDS = { oauth: 'OAuth', header: 'Bearer token', none: 'None' } as const;

/** One server: what Hermes has configured, a test with the full tool inventory, the OAuth sign-in, edit and delete. A full-screen sheet on a phone, a dialog elsewhere. */
export function McpDetail({ server, runtime, profile, reload, onEdit, onClose }: { server: McpServer; runtime: RuntimeState | undefined; profile: string; reload(): Promise<void>; onEdit(): void; onClose(): void }) {
  const [probe, setProbe] = useState<Probe>();
  const [busy, setBusy] = useState<'test' | 'sign-in' | 'delete'>();
  const [flow, setFlow] = useState<OauthFlow>();
  const status = statusOf(server, runtime);
  const canSignIn = server.url !== undefined && server.auth !== 'header';

  const test = async () => {
    setBusy('test');
    const outcome = await probeServer(server, profile);
    setBusy(undefined);
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    if (outcome.kind === 'done') setProbe(outcome.body);
  };

  const signIn = async () => {
    setBusy('sign-in');
    const outcome = await startSignIn(server, profile);
    setBusy(undefined);
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    if (outcome.kind === 'done') setFlow(outcome.body);
  };

  const remove = async () => {
    setBusy('delete');
    const outcome = await deleteServer(server.name, profile);
    setBusy(undefined);
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    if (outcome.kind !== 'done') return;
    toast(`Deleted ${server.name} from ${profile}`, { detail: 'Add it again to get it back.' });
    await reload();
    onClose();
  };

  const filter = filterWords(server.filter);
  return (
    <>
      <Sheet title={`${server.name} · ${profile}`} detents={['full']} className="tl-sheet" onClose={onClose}>
        <div className="tl-form">
          <div className="tl-drawer__head">
            <StatusBadge state={status.state} label={status.label} variant="plain" />
            <span className="tag">{TRANSPORT_WORDS[server.transport]}</span>
            {status.detail && <span className="subtle">{status.detail}</span>}
          </div>
          <dl className="tl-facts">
            {server.command ? (
              <>
                <dt>Runs</dt>
                <dd>
                  <code className="tl-code">{commandLine(server.command, server.args)}</code>
                </dd>
              </>
            ) : (
              <>
                <dt>Address</dt>
                <dd>
                  <code className="tl-code">{server.url ?? 'none'}</code>
                </dd>
              </>
            )}
            <dt>Sign-in</dt>
            <dd>{AUTH_WORDS[server.auth ?? 'none']}</dd>
            {server.envNames.length > 0 && (
              <>
                <dt>Variables</dt>
                <dd>
                  {server.envNames.join(', ')} <span className="subtle">· values are never shown</span>
                </dd>
              </>
            )}
            {filter && (
              <>
                <dt>Tools allowed</dt>
                <dd>{filter}</dd>
              </>
            )}
          </dl>
          <div className="tl-actions">
            <WriteButton type="button" className="btn btn--primary" disabled={busy !== undefined} aria-busy={busy === 'test'} onClick={() => void test()}>
              <Icon name="play" />
              Test server…
            </WriteButton>
            {canSignIn && (
              <WriteButton type="button" className="btn btn--secondary" disabled={busy !== undefined} aria-busy={busy === 'sign-in'} onClick={() => void signIn()}>
                <Icon name="key" />
                Sign in…
              </WriteButton>
            )}
            <WriteButton type="button" className="btn btn--secondary" disabled={busy !== undefined} onClick={onEdit}>
              <Icon name="sliders" />
              Edit…
            </WriteButton>
            <WriteButton type="button" className="btn btn--danger" disabled={busy !== undefined} aria-busy={busy === 'delete'} onClick={() => void remove()}>
              <Icon name="trash" />
              Delete…
            </WriteButton>
          </div>
          {probe && (
            <section className="tl-section" aria-label={`Test of ${server.name}`}>
              <h3>Test result</h3>
              {probe.ok ? (
                <div className="banner" data-tone="success" role="status">
                  <Icon name="check" />
                  <span className="banner__content">
                    {server.name} answered with {probe.tools.length} {probe.tools.length === 1 ? 'tool' : 'tools'}
                    {probe.prompts + probe.resources > 0 ? `, ${probe.prompts} prompts and ${probe.resources} resources` : ''}.
                  </span>
                </div>
              ) : (
                <div className="banner" data-tone="danger" role="alert">
                  <Icon name="alert" />
                  <span className="banner__content">The test failed{probe.error ? `: ${probe.error}` : '.'}</span>
                </div>
              )}
              {probe.ok && (
                <>
                  <h3>
                    <Term id="mcp-tool-inventory">Tool inventory</Term>
                  </h3>
                  {probe.tools.length === 0 ? (
                    <p className="tl-note">The server has no tools.</p>
                  ) : (
                    <ul className="tl-tools" aria-label={`Tools of ${server.name}`}>
                      {probe.tools.map((tool) => (
                        <li key={tool.name}>
                          <span className="tl-tools__name mono">{tool.name}</span>
                          {tool.description && <span className="tl-tools__desc">{tool.description}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </section>
          )}
        </div>
      </Sheet>
      {flow && (
        <McpSignIn
          key={flow.id}
          server={server}
          profile={profile}
          flow={flow}
          onRetry={() => {
            setFlow(undefined);
            void signIn();
          }}
          onFinished={() => void reload()}
          onClose={() => setFlow(undefined)}
        />
      )}
    </>
  );
}
