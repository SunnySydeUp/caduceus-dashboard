import { lazy, Suspense, useEffect, useState, type FormEvent } from 'react';
import type { AuthState } from '@caduceus/contracts/caduceus-api';
import { safeNext } from '@caduceus/contracts/safe-next';
import { cancelPasskeyPrompt, PasskeyError, signInWithPasskey } from './passkeys.ts';
import { signInErrorMessage } from './modules/settings/audit-model.ts';

/** Where to go after signing in: the `next` page the server redirected from, if it is a path on this origin. */
function nextPath(): string {
  return safeNext(new URLSearchParams(location.search).get('next'), location.origin);
}

// The sign-in screen stays small: its help (the panel, every page and the glossary) is a chunk that loads when it is asked for.
const SignInHelp = lazy(() => import('./SignInHelp.tsx'));

/** Help for this screen (M1 #02): a button, and `?` when focus is not in a field. */
function HelpButton() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (event.key === '?' && !event.defaultPrevented && !event.metaKey && !event.ctrlKey && !event.altKey && !target?.closest('input, textarea, select, [contenteditable]')) setOpen(true);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);
  return (
    <>
      <button type="button" className="btn btn--ghost sign-in-help" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        Help signing in
      </button>
      {open && (
        <Suspense fallback={null}>
          <SignInHelp onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  );
}

/** What the server's refusal means for the owner. */
async function refusalMessage(res: Response): Promise<string> {
  const body: unknown = await res.json().catch(() => undefined);
  const error = typeof body === 'object' && body !== null && 'error' in body ? body.error : undefined;
  if (error === 'wrong-password') return 'That password is not right.';
  if (error === 'password-too-short') return 'Use at least 12 characters.';
  if (error === 'setup-not-local') return 'Set the owner password on the Mac that runs Caduceus.';
  if (error === 'throttled' && typeof body === 'object' && body !== null && 'retryAfterSeconds' in body) {
    const minutes = Math.ceil(Number(body.retryAfterSeconds) / 60);
    return `Too many wrong passwords. Try again in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`;
  }
  return `Caduceus could not sign you in (HTTP ${res.status}).`;
}

export function SignIn() {
  const [state, setState] = useState<AuthState>();
  const [error, setError] = useState<string>();
  // Where the way back from the identity provider says it ended (`?error=oidc-…`).
  const [passkeyError, setPasskeyError] = useState<string | undefined>(() => signInErrorMessage(new URLSearchParams(location.search).get('error')));
  const [busy, setBusy] = useState(false);
  // The browser's own check of the passkeys on this address, before the owner did anything: a calm note, not an error.
  const [autofillNote, setAutofillNote] = useState<string>();
  const [showPassword, setShowPassword] = useState(false);
  // Bumped after a passkey prompt, so the password field offers passkeys again (the prompt ended the autofill request).
  const [autofillRound, setAutofillRound] = useState(0);

  useEffect(() => {
    void fetch('/_caduceus/api/auth/session')
      .then((res) => res.json())
      .then((auth: AuthState) => {
        if (auth.signedIn) return location.replace(nextPath());
        // Nobody is signed in here (signed out, or the session ended): the copy of Home that older versions kept on this device does not stay.
        localStorage.removeItem('caduceus.home-snapshot');
        setState(auth);
      });
  }, []);

  const settingUp = state !== undefined && !state.ownerExists;
  const passwordForm = settingUp || state?.passwordSignIn === true;

  useEffect(() => {
    // Conditional UI: where the browser supports it, the password field's autofill also offers the owner's passkeys.
    if (!state?.ownerExists || !state.passwordSignIn) return;
    let active = true;
    void import('@simplewebauthn/browser').then(({ browserSupportsWebAuthnAutofill }) => browserSupportsWebAuthnAutofill()).then(async (supported) => {
      if (!supported || !active) return;
      try {
        if (await signInWithPasskey(true)) location.assign(nextPath());
      } catch (failure) {
        if (active && failure instanceof PasskeyError && !failure.cancelled) setAutofillNote(failure.message);
      }
    });
    return () => {
      active = false;
      void cancelPasskeyPrompt();
    };
  }, [state, autofillRound]);

  const signInWithPasskeyPrompt = async () => {
    setBusy(true);
    setPasskeyError(undefined);
    setAutofillNote(undefined);
    try {
      if (await signInWithPasskey(false)) return location.assign(nextPath());
    } catch (failure) {
      setPasskeyError(failure instanceof PasskeyError ? failure.message : 'Caduceus is not reachable. Check the connection and try again.');
    }
    setBusy(false);
    setAutofillRound((round) => round + 1);
  };

  const signInWithTailscale = async () => {
    setBusy(true);
    setPasskeyError(undefined);
    const res = await fetch('/_caduceus/api/auth/tailscale-sign-in', { method: 'POST' }).catch(() => undefined);
    if (res?.ok) return location.assign(nextPath());
    setPasskeyError(res ? 'Tailscale did not name the login Caduceus allows, so nobody was signed in.' : 'Caduceus is not reachable. Check the connection and try again.');
    setBusy(false);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    const password = new FormData(event.currentTarget).get('password');
    const res = await fetch(`/_caduceus/api/auth/${settingUp ? 'setup' : 'sign-in'}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password }),
    }).catch(() => undefined);
    if (res?.ok) return location.assign(nextPath());
    setError(res ? await refusalMessage(res) : 'Caduceus is not reachable. Check the connection and try again.');
    setBusy(false);
  };

  if (!state) return <main className="sign-in" aria-busy="true" />;

  if (settingUp && !state.setupAllowed) {
    return (
      <main className="sign-in">
        <section className="sign-in-card" aria-labelledby="sign-in-title">
          <h1 id="sign-in-title">Caduceus has no owner yet</h1>
          <p className="help-text">Open Caduceus on the Mac that runs it and set the owner password there.</p>
          <HelpButton />
        </section>
      </main>
    );
  }

  return (
    <main className="sign-in">
      <section className="sign-in-card" aria-labelledby="sign-in-title">
        <h1 id="sign-in-title">{settingUp ? 'Set the owner password' : 'Sign in to Caduceus'}</h1>
        {settingUp && <p className="help-text">This password protects Caduceus on every device. You set it once, here on this Mac.</p>}
        {!passwordForm && <p className="help-text">Password sign-in is off. Sign in with one of your passkeys.</p>}
        {passwordForm && (
          <form className="sign-in-form" aria-labelledby="sign-in-title" onSubmit={submit}>
            {/* There is one account; the name lets password managers file the password. */}
            <input type="text" name="username" autoComplete="username" value="owner" readOnly hidden />
            <div className="sign-in-field">
              <label htmlFor="password">{settingUp ? 'New password' : 'Password'}</label>
              <div className="sign-in-password">
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  // `webauthn` lets the browser offer passkeys in this field's autofill (conditional UI).
                  autoComplete={settingUp ? 'new-password' : 'current-password webauthn'}
                  required
                  minLength={settingUp ? 12 : undefined}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={[settingUp ? 'password-help' : '', error ? 'password-error' : ''].join(' ').trim() || undefined}
                  autoFocus
                />
                <button
                  type="button"
                  className="btn btn--secondary"
                  aria-controls="password"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
              {settingUp && (
                <p id="password-help" className="help-text">
                  At least 12 characters. Pasting from a password manager works.
                </p>
              )}
              {error && (
                <p id="password-error" className="error-text" role="alert">
                  {error}
                </p>
              )}
            </div>
            <button type="submit" className="btn btn--primary" disabled={busy}>
              {settingUp ? 'Set password and sign in' : 'Sign in'}
            </button>
          </form>
        )}
        {!settingUp && (
          <>
            {passwordForm && <p className="sign-in-or">or</p>}
            <button type="button" className={passwordForm ? 'btn btn--secondary' : 'btn btn--primary'} disabled={busy} onClick={() => void signInWithPasskeyPrompt()}>
              Sign in with a passkey
            </button>
            {state.oidcSignIn && (
              <a className="btn btn--secondary" href={`/_caduceus/api/auth/oidc/start?next=${encodeURIComponent(nextPath())}`}>
                Sign in with {state.oidcSignIn.provider}
              </a>
            )}
            {state.tailscaleSignIn && (
              <button type="button" className="btn btn--secondary" disabled={busy} onClick={() => void signInWithTailscale()}>
                Sign in with Tailscale
              </button>
            )}
            {passkeyError && (
              <p className="error-text" role="alert">
                {passkeyError}
              </p>
            )}
            {!passkeyError && autofillNote && <p className="help-text">{autofillNote}</p>}
          </>
        )}
        <HelpButton />
      </section>
    </main>
  );
}
