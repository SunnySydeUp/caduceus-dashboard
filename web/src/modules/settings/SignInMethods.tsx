// Settings › Security › Other sign-in methods (M5 #15): OIDC against the owner's identity provider and Tailscale identity sign-in. Both are additions to the
// password and passkeys, which always remain. Turning one on or changing it is Tier 2 (a passkey); OIDC is tested against the provider first, and Tailscale is
// tested by this very request: it must come through Tailscale as the login being allowed.
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { AuthMethods } from '@caduceus/contracts/caduceus-api';
import { fetchWithStepUp } from '../../passkeys.ts';
import { Term } from '../../shell/Term.tsx';
import { confirmTier } from '../../shell/tier-confirmation.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { methodRefusal } from './audit-model.ts';

type Say = (message: string) => void;

/** Sends a change of a method behind a passkey step-up; the words of its refusal, or `undefined` when it went through. */
async function send(method: 'PUT' | 'POST', path: string, body: unknown): Promise<{ failure?: string; body?: unknown }> {
  const res = await fetchWithStepUp(() => fetch(path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
  const answer: unknown = await res.json().catch(() => undefined);
  if (res.ok) return { body: answer };
  const record = typeof answer === 'object' && answer !== null ? (answer as { error?: string; message?: string }) : {};
  return { failure: methodRefusal(record.error, record.message) };
}

function OidcCard({ oidc, reload, say }: { oidc: AuthMethods['oidc']; reload(): Promise<void>; say: Say }) {
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [tested, setTested] = useState(false);

  const read = (form: HTMLFormElement) => {
    const data = new FormData(form);
    const secret = String(data.get('clientSecret') ?? '');
    return { issuer: String(data.get('issuer')).trim(), clientId: String(data.get('clientId')).trim(), allowedUser: String(data.get('allowedUser')).trim(), ...(secret ? { clientSecret: secret } : {}) };
  };

  const run = async (form: HTMLFormElement, kind: 'test' | 'save' | 'off') => {
    setError(undefined);
    setTested(false);
    if (kind !== 'test') {
      const ok = await confirmTier({
        tier: 'T2',
        moduleId: 'security',
        action: 'auth.method-oidc-set',
        label: kind === 'off' ? 'Turn off sign-in with your identity provider?' : 'Turn on sign-in with your identity provider?',
        text: kind === 'off' ? 'Nobody can sign in that way any more. Your password and passkeys still work.' : 'Caduceus asks the provider first. Once on, the one identity you allow can sign in through it.',
        object: 'OIDC',
        confirmLabel: kind === 'off' ? 'Turn off' : 'Save and turn on',
      });
      if (!ok) return;
    }
    setBusy(true);
    const result = kind === 'test' ? await send('POST', '/_caduceus/api/auth/methods/oidc/test', read(form)) : await send('PUT', '/_caduceus/api/auth/methods/oidc', kind === 'off' ? { enabled: false } : { ...read(form), enabled: true });
    setBusy(false);
    if (result.failure) return setError(result.failure);
    if (kind === 'test') setTested(true);
    else {
      say(kind === 'off' ? 'Sign-in with your identity provider is off.' : 'Sign-in with your identity provider is on.');
      await reload();
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void run(event.currentTarget, 'save');
  };

  return (
    <form className="settings-form" aria-labelledby="oidc-title" onSubmit={submit}>
      <h3 id="oidc-title">
        OpenID Connect {oidc.enabled ? <span className="chip">On</span> : <span className="chip">Off</span>}
      </h3>
      <p className="help-text">
        Sign in with your own identity provider (<Term id="oidc">OIDC</Term>: Google, Authentik, Keycloak and the like). Register this redirect address with the provider: <code className="mt-code">{oidc.redirectUri}</code>
      </p>
      <label htmlFor="oidc-issuer">Issuer</label>
      <input id="oidc-issuer" name="issuer" className="input" type="url" inputMode="url" autoCapitalize="none" spellCheck={false} placeholder="https://accounts.example.com" defaultValue={oidc.issuer ?? ''} required />
      <label htmlFor="oidc-client">Client ID</label>
      <input id="oidc-client" name="clientId" className="input" autoCapitalize="none" spellCheck={false} defaultValue={oidc.clientId ?? ''} required />
      <label htmlFor="oidc-secret">Client secret</label>
      <input id="oidc-secret" name="clientSecret" className="input" type="password" autoComplete="off" placeholder={oidc.hasSecret ? 'Kept. Type to replace it.' : 'Leave empty for a public client'} />
      <label htmlFor="oidc-user">Allowed user</label>
      <input id="oidc-user" name="allowedUser" className="input" autoCapitalize="none" spellCheck={false} placeholder="you@example.com, or the provider’s subject" defaultValue={oidc.allowedUser ?? ''} required />
      <p className="help-text">Only this identity can sign in: an email address (the provider must say it is verified) or the provider’s subject id.</p>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {tested && <p role="status">The provider answered as this issuer, so it can be turned on.</p>}
      <div className="settings-actions">
        <WriteButton type="button" className="btn btn--secondary" disabled={busy} onClick={(event) => void run(event.currentTarget.form!, 'test')}>
          Test provider
        </WriteButton>
        <WriteButton type="submit" className="btn btn--primary" disabled={busy}>
          {oidc.enabled ? 'Save changes' : 'Save and turn on'}
        </WriteButton>
        {oidc.enabled && (
          <WriteButton type="button" className="btn btn--secondary" disabled={busy} onClick={(event) => void run(event.currentTarget.form!, 'off')}>
            Turn off
          </WriteButton>
        )}
      </div>
    </form>
  );
}

function TailscaleCard({ methods, reload, say }: { methods: AuthMethods; reload(): Promise<void>; say: Say }) {
  const { tailscale, tailnetIdentity } = methods;
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const login = tailscale.login ?? tailnetIdentity;

  const change = async (enabled: boolean) => {
    setError(undefined);
    const ok = await confirmTier({
      tier: 'T2',
      moduleId: 'security',
      action: 'auth.method-tailscale-set',
      label: enabled ? 'Turn on Tailscale identity sign-in?' : 'Turn off Tailscale identity sign-in?',
      text: enabled ? `Anyone who reaches Caduceus through Tailscale as ${login} can sign in with one tap. Caduceus trusts only what Tailscale Serve on this Mac says.` : 'Tailscale identity sign-in stops. Your password and passkeys still work.',
      object: 'Tailscale identity',
      confirmLabel: enabled ? 'Turn on' : 'Turn off',
    });
    if (!ok) return;
    setBusy(true);
    const result = await send('PUT', '/_caduceus/api/auth/methods/tailscale', enabled ? { enabled, login } : { enabled });
    setBusy(false);
    if (result.failure) return setError(result.failure);
    say(enabled ? 'Tailscale identity sign-in is on.' : 'Tailscale identity sign-in is off.');
    await reload();
  };

  return (
    <div className="settings-form" role="group" aria-labelledby="ts-title">
      <h3 id="ts-title">
        Tailscale identity {tailscale.enabled ? <span className="chip">On</span> : <span className="chip">Off</span>}
      </h3>
      <p className="help-text">
        Sign in with one tap when you reach Caduceus through Tailscale as the login you allow (your <Term id="tailscale-identity">Tailscale identity</Term>). It is turned on from that address, which is also its test: Caduceus must see that login on this very request.
      </p>
      <p>{tailscale.login ? `Allowed login: ${tailscale.login}` : tailnetIdentity ? `This request came through Tailscale as ${tailnetIdentity}.` : 'This request did not come through Tailscale, so it cannot be turned on from here. Open Caduceus at its Tailscale address.'}</p>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <div className="settings-actions">
        {!tailscale.enabled && (
          <WriteButton type="button" className="btn btn--primary" disabled={busy || !login} onClick={() => void change(true)}>
            Turn on
          </WriteButton>
        )}
        {tailscale.enabled && (
          <WriteButton type="button" className="btn btn--secondary" disabled={busy} onClick={() => void change(false)}>
            Turn off
          </WriteButton>
        )}
      </div>
    </div>
  );
}

export function SignInMethods({ say }: { say: Say }) {
  const [methods, setMethods] = useState<AuthMethods>();
  const reload = useCallback(async () => {
    const res = await fetch('/_caduceus/api/auth/methods');
    if (res.ok) setMethods((await res.json()) as AuthMethods);
  }, []);
  useEffect(() => void reload(), [reload]);
  if (!methods) return null;
  return (
    <section className="settings-section" aria-labelledby="methods-title">
      <h2 id="methods-title">Other sign-in methods</h2>
      <p className="help-text">These are in addition to your password and passkeys, which always stay: at least one of them can never be removed.</p>
      <OidcCard key={`${methods.oidc.issuer}${methods.oidc.enabled}`} oidc={methods.oidc} reload={reload} say={say} />
      <TailscaleCard methods={methods} reload={reload} say={say} />
    </section>
  );
}
