import { useEffect, useId, useRef, useState } from 'react';
import { Icon } from '../../icons.tsx';
import { Sheet } from '../../overlays/Sheet.tsx';
import { toast } from '../../shell/toasts.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { cancelSignIn, relaySignIn } from './mcp-actions.ts';
import { read } from './mcp-data.ts';
import { oauthFlowStatus, parseOauthFlow, type McpServer, type OauthFlow } from './mcp-model.ts';

/** How often the sheet asks Hermes how the sign-in is going: Hermes sends no event when a flow ends, and the flow ends on a worker thread of its own. */
const LOOK_MS = 1000;

/** A web address is safe to open only when it is a web address. */
function webAddress(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const { protocol } = new URL(url);
    return protocol === 'https:' || protocol === 'http:' ? url : undefined;
  } catch {
    return undefined;
  }
}

/** The OAuth sign-in of an MCP server, as Hermes runs it: where to sign in, whether it has finished and, when it failed, why. */
export function McpSignIn({ server, profile, flow: first, onRetry, onFinished, onClose }: { server: McpServer; profile: string; flow: OauthFlow; onRetry(): void; onFinished(): void; onClose(): void }) {
  const [flow, setFlow] = useState(first);
  const [pasted, setPasted] = useState('');
  const [busy, setBusy] = useState(false);
  const pastedId = useId();
  const over = flow.status === 'approved' || flow.status === 'error';
  const finished = useRef(onFinished);
  finished.current = onFinished;

  useEffect(() => {
    if (over) return;
    let current = true;
    const timer = setTimeout(() => {
      read(oauthFlowStatus(flow.id).path).then(
        (answer) => {
          if (!current) return;
          const next = parseOauthFlow(answer);
          setFlow({ ...next, id: flow.id });
          if (next.status === 'approved') finished.current();
        },
        // A look that fails is tried again at the next tick; the flow may be gone (Hermes forgets it after a few minutes), which is said below.
        () => current && setFlow((now) => ({ ...now })),
      );
    }, LOOK_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [flow, over]);

  const close = () => {
    if (!over) void cancelSignIn(flow);
    onClose();
  };

  const hand = async () => {
    setBusy(true);
    const outcome = await relaySignIn(pasted, server, profile);
    setBusy(false);
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    if (outcome.kind === 'done') {
      toast('Handed to Hermes', { detail: 'It finishes the sign-in now.' });
      setPasted('');
    }
  };

  const link = webAddress(flow.url);
  return (
    <Sheet title={`Sign in to ${server.name}`} detents={['full']} className="tl-sheet" onClose={close}>
      <div className="tl-form">
        {flow.status === 'starting' && <p role="status">Hermes is starting the sign-in…</p>}
        {flow.status === 'authorization_required' && (
          <>
            <p className="tl-note">Open the provider’s sign-in page, sign in and allow access. Hermes finishes the sign-in by itself when the provider sends the browser back to it. Caduceus never sees your password.</p>
            {link ? (
              <div className="tl-actions">
                <a className="btn btn--primary" href={link} target="_blank" rel="noreferrer noopener">
                  <Icon name="external" />
                  Open the sign-in page
                </a>
              </div>
            ) : (
              <p className="tl-trouble" role="alert">
                Hermes gave no web address to sign in at.
              </p>
            )}
            <p role="status" className="subtle">
              Waiting for the sign-in to finish…
            </p>
            <details className="tl-advanced">
              <summary>The page after signing in does not load?</summary>
              <div className="tl-form">
                <p className="tl-note">The provider sends the browser back to Hermes’s own address on the computer it runs on, so a phone or another computer cannot open it. Copy the address from the browser’s address bar after the redirect (it contains <code>/api/mcp/oauth/callback/</code>) and paste it here.</p>
                <div className="field">
                  <label className="field__label" htmlFor={pastedId}>
                    Address the browser ended at
                  </label>
                  <textarea id={pastedId} className="input input--mono tl-area" rows={3} autoCapitalize="off" autoComplete="off" spellCheck={false} value={pasted} onChange={(event) => setPasted(event.target.value)} />
                </div>
                <div className="tl-actions">
                  <WriteButton type="button" className="btn btn--secondary" disabled={pasted.trim() === '' || busy} aria-busy={busy} onClick={() => void hand()}>
                    <Icon name="check" />
                    Hand it to Hermes…
                  </WriteButton>
                </div>
              </div>
            </details>
          </>
        )}
        {flow.status === 'approved' && (
          <div className="banner" data-tone="success" role="status">
            <Icon name="check" />
            <span className="banner__content">{server.name} is signed in. Hermes saved its token for this profile. Test the server to see its tools.</span>
          </div>
        )}
        {flow.status === 'error' && (
          <div className="banner" data-tone="danger" role="alert">
            <Icon name="alert" />
            <span className="banner__content">The sign-in did not finish{flow.error ? `: ${flow.error}` : '.'}</span>
            <button type="button" className="btn btn--secondary btn--sm" onClick={onRetry}>
              <Icon name="refresh" />
              Try again
            </button>
          </div>
        )}
        <div className="tl-actions">
          <button type="button" className="btn btn--secondary" onClick={close}>
            {over ? 'Close' : 'Cancel the sign-in'}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
