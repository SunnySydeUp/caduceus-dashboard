import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { AuthState, Passkey, SessionInfo } from '@caduceus/contracts/caduceus-api';
import type { PushDevice } from '@caduceus/contracts/push';
import { errorCode, fetchWithStepUp, PasskeyError, passkeysSupported, postJson, registerPasskey } from '../../passkeys.ts';
import { setReadOnly, useReadOnly } from '../../policy-state.ts';
import { noteMeaningfulAction } from '../../shell/install.ts';
import { AppLink } from '../../shell/navigation.tsx';
import { PageHeader } from '../../shell/PageHeader.tsx';
import { Term } from '../../shell/Term.tsx';
import { confirmTier } from '../../shell/tier-confirmation.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { SharesSection } from '../shares/SharesSection.tsx';
import { SignInMethods } from './SignInMethods.tsx';

/** A readable name for the device a User-Agent belongs to, e.g. "Safari on iPhone". */
function deviceName(userAgent: string): { browser?: string; os?: string } {
  const os = /iPhone/.test(userAgent)
    ? 'iPhone'
    : /iPad/.test(userAgent)
      ? 'iPad'
      : /Android/.test(userAgent)
        ? 'Android'
        : /Macintosh|Mac OS X/.test(userAgent)
          ? 'Mac'
          : /Windows/.test(userAgent)
            ? 'Windows'
            : /Linux|CrOS/.test(userAgent)
              ? 'Linux'
              : undefined;
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /Firefox\/|FxiOS\//.test(userAgent)
      ? 'Firefox'
      : /Chrome\/|CriOS\//.test(userAgent)
        ? 'Chrome'
        : /Safari\//.test(userAgent)
          ? 'Safari'
          : undefined;
  return { browser, os };
}

function deviceLabel(userAgent: string): string {
  const { browser, os } = deviceName(userAgent);
  if (browser && os) return `${browser} on ${os}`;
  return browser ?? os ?? 'Unknown device';
}

const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

/** "5 minutes ago", "yesterday"; Caduceus records last use to the minute. */
function ago(iso: string): string {
  const minutes = Math.round((Date.parse(iso) - Date.now()) / 60_000);
  if (minutes > -1) return 'just now';
  if (minutes > -60) return relative.format(minutes, 'minute');
  if (minutes > -24 * 60) return relative.format(Math.round(minutes / 60), 'hour');
  return relative.format(Math.round(minutes / (24 * 60)), 'day');
}

const UNREACHABLE = 'Caduceus is not reachable. Check the connection and try again.';

/** Settings › Security: passkeys, the password, and signed-in devices. */
export function Security() {
  const [auth, setAuth] = useState<AuthState>();
  const [passkeys, setPasskeys] = useState<Passkey[]>();
  const [sessions, setSessions] = useState<SessionInfo[]>();
  const [pushDevices, setPushDevices] = useState<PushDevice[]>([]);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    const [authRes, passkeysRes, sessionsRes, pushRes] = await Promise.all([
      fetch('/_caduceus/api/auth/session'),
      fetch('/_caduceus/api/auth/passkeys'),
      fetch('/_caduceus/api/auth/sessions'),
      fetch('/_caduceus/api/push/subscriptions'),
    ]);
    // Signed out meanwhile (expired, or this device was revoked elsewhere): sign in again and come back.
    if (passkeysRes.status === 401 || sessionsRes.status === 401) {
      return location.assign(`/sign-in?next=${encodeURIComponent(location.pathname)}`);
    }
    setAuth(await authRes.json());
    setPasskeys((await passkeysRes.json()).passkeys);
    setSessions((await sessionsRes.json()).sessions);
    setPushDevices(pushRes.ok ? (await pushRes.json()).devices : []);
  }, []);

  useEffect(() => {
    void load().catch(() => setError(UNREACHABLE));
  }, [load]);

  // Devices sign in and out elsewhere while this page is open: look again whenever the page is seen again.
  useEffect(() => {
    const again = () => document.visibilityState === 'visible' && void load().catch(() => undefined);
    document.addEventListener('visibilitychange', again);
    window.addEventListener('focus', again);
    return () => {
      document.removeEventListener('visibilitychange', again);
      window.removeEventListener('focus', again);
    };
  }, [load]);

  /** Runs a change, then reloads the page's data and announces `done` (or shows the failure). */
  const change = async (run: () => Promise<string | undefined>) => {
    setError(undefined);
    setStatus('');
    try {
      const failure = await run();
      if (failure) setError(failure);
      await load();
    } catch (failure) {
      setError(failure instanceof PasskeyError ? failure.message : UNREACHABLE);
    }
  };

  return (
    <div className="page-stack">
      <PageHeader title="Security" subtitle="Passkeys, the password and every signed-in device." />
      <p className="sr-only" role="status">
        {status}
      </p>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {passkeys && auth && sessions && (
        <>
          <PasskeysSection passkeys={passkeys} hasPassword={auth.passwordSignIn} change={change} announce={setStatus} />
          <PasswordSection hasPassword={auth.passwordSignIn} hasPasskeys={passkeys.length > 0} change={change} announce={setStatus} />
          <SignInMethods say={setStatus} />
          <section className="settings-section" aria-labelledby="audit-link-title">
            <h2 id="audit-link-title">Audit log</h2>
            <p className="help-text">
              Every sign-in, change and refusal Caduceus recorded, with filters and export. <AppLink to="/system/security/audit">Open the audit log</AppLink>
            </p>
          </section>
          <ReadOnlySection hasPasskeys={passkeys.length > 0} change={change} announce={setStatus} />
          <SharesSection />
          <DevicesSection sessions={sessions} change={change} announce={setStatus} />
          <NotificationDevicesSection devices={pushDevices} change={change} announce={setStatus} />
        </>
      )}
    </div>
  );
}

interface SectionProps {
  change(run: () => Promise<string | undefined>): Promise<void>;
  announce(message: string): void;
}

/** What a refused change means for the owner. */
async function refusal(res: Response): Promise<string | undefined> {
  if (res.ok) return undefined;
  const code = await errorCode(res);
  if (code === 'last-sign-in-method') return 'This is your only way to sign in, so it cannot be removed. Add another passkey or a password first.';
  if (code === 'step-up-required') return 'Not changed: confirming with a passkey was cancelled.';
  if (code === 'password-too-short') return 'Use at least 12 characters.';
  return `Caduceus could not make the change (HTTP ${res.status}).`;
}

function PasskeysSection({ passkeys, hasPassword, change, announce }: SectionProps & { passkeys: Passkey[]; hasPassword: boolean }) {
  const [renaming, setRenaming] = useState<string>();
  const [adding, setAdding] = useState(false);
  const supported = passkeysSupported();

  const add = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get('name')).trim();
    setAdding(true);
    void change(async () => {
      await registerPasskey(name);
      noteMeaningfulAction();
      announce(`Passkey “${name}” added.`);
      return undefined;
    }).finally(() => setAdding(false));
  };

  const rename = (event: FormEvent<HTMLFormElement>, passkey: Passkey) => {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get('name')).trim();
    void change(async () => {
      const failure = await refusal(await postJson(`/_caduceus/api/auth/passkeys/${encodeURIComponent(passkey.id)}`, { name }, 'PATCH'));
      if (!failure) {
        setRenaming(undefined);
        announce(`Renamed to “${name}”.`);
      }
      return failure;
    });
  };

  // Deleting a passkey is T2: the shared dialog asks, naming it, and the server wants a step-up with a passkey.
  const remove = (passkey: Passkey) =>
    void change(async () => {
      const confirmed = await confirmTier({
        tier: 'T2',
        moduleId: 'security',
        action: 'passkey.delete',
        label: `Delete the passkey “${passkey.name}”?`,
        text: 'You can no longer sign in or confirm changes with it.',
        object: passkey.name,
        confirmLabel: 'Delete passkey',
      });
      if (!confirmed) return undefined;
      const failure = await refusal(await fetchWithStepUp(() => fetch(`/_caduceus/api/auth/passkeys/${encodeURIComponent(passkey.id)}`, { method: 'DELETE' })));
      if (!failure) announce(`Passkey “${passkey.name}” deleted.`);
      return failure;
    });

  return (
    <section className="settings-section" aria-labelledby="passkeys-title" data-setting-field="security/passkeys" tabIndex={-1}>
      <h2 id="passkeys-title">Passkeys</h2>
      <p className="help-text">
        Sign in and confirm sensitive changes with Face ID, Touch ID, a security key or your password manager. Nobody can phish a <Term id="passkey">passkey</Term>.
      </p>
      {passkeys.length === 0 && <p>No passkeys yet.</p>}
      {passkeys.length > 0 && (
        <ul className="settings-list">
          {passkeys.map((passkey) => {
            const onlyMethod = !hasPassword && passkeys.length === 1;
            return (
              <li key={passkey.id} className="settings-row">
                {renaming === passkey.id ? (
                  <form className="settings-inline-form" onSubmit={(event) => rename(event, passkey)}>
                    <label htmlFor={`rename-${passkey.id}`}>Name</label>
                    <input id={`rename-${passkey.id}`} name="name" className="input" defaultValue={passkey.name} required maxLength={64} autoFocus />
                    <div className="settings-actions">
                      <WriteButton type="submit" className="btn btn--primary">
                        Save
                      </WriteButton>
                      <button type="button" className="btn btn--secondary" onClick={() => setRenaming(undefined)}>
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <>
                    <div className="settings-row-text">
                      <strong>{passkey.name}</strong>
                      <span className="help-text">
                        Added {dateTime.format(Date.parse(passkey.createdAt))} · {passkey.lastUsedAt ? `Last used ${ago(passkey.lastUsedAt)}` : 'Not used yet'}
                      </span>
                    </div>
                    <div className="settings-actions">
                      <button type="button" className="btn btn--secondary" aria-label={`Rename ${passkey.name}`} onClick={() => setRenaming(passkey.id)}>
                        Rename
                      </button>
                      <WriteButton
                        type="button"
                        className="btn btn--secondary"
                        aria-label={`Delete ${passkey.name}`}
                        aria-describedby={onlyMethod ? 'only-method' : undefined}
                        disabled={onlyMethod}
                        onClick={() => remove(passkey)}
                      >
                        Delete
                      </WriteButton>
                    </div>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {!hasPassword && passkeys.length === 1 && (
        <p id="only-method" className="help-text">
          This passkey is your only way to sign in, so it cannot be deleted. Add another passkey or a password first.
        </p>
      )}
      {supported ? (
        <form className="settings-inline-form" onSubmit={add}>
          <label htmlFor="new-passkey-name">Name for the new passkey</label>
          <input id="new-passkey-name" name="name" className="input" defaultValue={deviceName(navigator.userAgent).os ?? 'Passkey'} required maxLength={64} />
          <div className="settings-actions">
            <WriteButton type="submit" className="btn btn--primary" disabled={adding}>
              Add a passkey
            </WriteButton>
          </div>
        </form>
      ) : (
        <p className="help-text">This browser cannot use passkeys here. Passkeys need HTTPS, or `localhost` on this Mac.</p>
      )}
    </section>
  );
}

function PasswordSection({ hasPassword, hasPasskeys, change, announce }: SectionProps & { hasPassword: boolean; hasPasskeys: boolean }) {
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const password = String(new FormData(event.currentTarget).get('password'));
    void change(async () => {
      const failure = await refusal(await fetchWithStepUp(() => postJson('/_caduceus/api/auth/password', { password }, 'PUT')));
      if (!failure) {
        setEditing(false);
        announce(hasPassword ? 'Password changed.' : 'Password set.');
      }
      return failure;
    });
  };

  const remove = () =>
    void change(async () => {
      const failure = await refusal(await fetchWithStepUp(() => fetch('/_caduceus/api/auth/password', { method: 'DELETE' })));
      setRemoving(false);
      if (!failure) announce('Password sign-in turned off.');
      return failure;
    });

  return (
    <section className="settings-section" aria-labelledby="password-title" data-setting-field="security/password" tabIndex={-1}>
      <h2 id="password-title">Password</h2>
      <p className="help-text">
        {hasPassword ? 'Password sign-in is on.' : 'Password sign-in is off: you sign in with passkeys only.'} Changing it asks for one of your passkeys.
      </p>
      {editing ? (
        <form className="settings-inline-form" onSubmit={save}>
          {/* There is one account; the name lets password managers file the password. */}
          <input type="text" name="username" autoComplete="username" value="owner" readOnly hidden />
          <label htmlFor="new-password">New password</label>
          <input
            id="new-password"
            name="password"
            type="password"
            className="input"
            autoComplete="new-password"
            required
            minLength={12}
            aria-describedby="new-password-help"
            autoFocus
          />
          <p id="new-password-help" className="help-text">
            At least 12 characters. Pasting from a password manager works.
          </p>
          <div className="settings-actions">
            <WriteButton type="submit" className="btn btn--primary">
              Save password
            </WriteButton>
            <button type="button" className="btn btn--secondary" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : removing ? (
        <div className="settings-confirm" role="group" aria-label="Turn off password sign-in?">
          <span>You will sign in with passkeys only.</span>
          <div className="settings-actions">
            <WriteButton type="button" className="btn btn--danger" onClick={remove}>
              Turn off
            </WriteButton>
            <button type="button" className="btn btn--secondary" onClick={() => setRemoving(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="settings-actions">
          <button type="button" className="btn btn--secondary" disabled={!hasPasskeys} onClick={() => setEditing(true)}>
            {hasPassword ? 'Change password' : 'Set a password'}
          </button>
          {hasPassword && (
            <button type="button" className="btn btn--secondary" disabled={!hasPasskeys} onClick={() => setRemoving(true)}>
              Turn off password sign-in
            </button>
          )}
        </div>
      )}
      {!hasPasskeys && <p className="help-text">Add a passkey first: it confirms password changes.</p>}
    </section>
  );
}

function ReadOnlySection({ hasPasskeys, change, announce }: SectionProps & { hasPasskeys: boolean }) {
  const on = useReadOnly();

  // Turning it on or off is T2, both ways: the shared dialog asks, and the server wants a step-up with a passkey.
  const toggle = () =>
    void change(async () => {
      const confirmed = await confirmTier({
        tier: 'T2',
        moduleId: 'security',
        action: 'policy.read-only',
        label: on ? 'Turn read-only mode off?' : 'Turn read-only mode on?',
        text: on ? 'Caduceus will change things in Hermes again.' : 'Caduceus will stop changing anything in Hermes, from every device, until you turn this off.',
        confirmLabel: on ? 'Turn off' : 'Turn on',
      });
      if (!confirmed) return undefined;
      const changed = await setReadOnly(!on);
      if (!changed) return 'Not changed: confirming with a passkey was cancelled, or Caduceus refused.';
      announce(on ? 'Read-only mode turned off.' : 'Read-only mode turned on.');
      return undefined;
    });

  return (
    <section className="settings-section" aria-labelledby="read-only-title" data-setting-field="security/read-only" tabIndex={-1}>
      <h2 id="read-only-title">Read-only mode</h2>
      <p className="help-text">
        <Term id="read-only-mode">Read-only mode</Term>
        {on ? ' is on: ' : ' is off. '}
        While it is on, Caduceus only reads from Hermes: nothing is changed from any device, and a banner says so. Turning it on or off asks for a passkey.
      </p>
      <div className="settings-actions">
        <WriteButton type="button" className="btn btn--secondary" disabled={!hasPasskeys} onClick={toggle}>
          {on ? 'Turn off read-only mode' : 'Turn on read-only mode'}
        </WriteButton>
      </div>
      {!hasPasskeys && <p className="help-text">Add a passkey first: it confirms this change.</p>}
    </section>
  );
}

function DevicesSection({ sessions, change, announce }: SectionProps & { sessions: SessionInfo[] }) {
  // Revoking a session is T1: the shared dialog names the device, and the password alone is enough (a lost phone must be cut off).
  const revoke = (session: SessionInfo) =>
    void change(async () => {
      const confirmed = await confirmTier({
        tier: 'T1',
        moduleId: 'security',
        action: 'session.revoke',
        label: session.current ? 'Sign out this device?' : `Sign out ${deviceLabel(session.userAgent)}?`,
        text: session.current ? 'You will have to sign in again.' : 'It is signed out at once and has to sign in again.',
        object: deviceLabel(session.userAgent),
        confirmLabel: session.current ? 'Sign out' : 'Revoke',
      });
      if (!confirmed) return undefined;
      const res = await fetch(`/_caduceus/api/auth/sessions/${encodeURIComponent(session.id)}`, { method: 'DELETE' });
      // Revoking this device signs it out.
      if (res.ok && session.current) {
        location.assign('/sign-in');
        return undefined;
      }
      const failure = await refusal(res);
      if (!failure) announce(`${deviceLabel(session.userAgent)} signed out.`);
      return failure;
    });

  const others = sessions.filter((session) => !session.current);
  const revokeOthers = () =>
    void change(async () => {
      const confirmed = await confirmTier({
        tier: 'T1',
        moduleId: 'security',
        action: 'session.revoke',
        label: 'Sign out every other device?',
        text: `${others.length} devices are signed out at once and have to sign in again. This device stays signed in.`,
        object: `${others.length} other devices`,
        confirmLabel: 'Sign out all',
      });
      if (!confirmed) return undefined;
      for (const session of others) {
        const failure = await refusal(await fetch(`/_caduceus/api/auth/sessions/${encodeURIComponent(session.id)}`, { method: 'DELETE' }));
        if (failure) return failure;
      }
      announce('Every other device signed out.');
      return undefined;
    });

  return (
    <section className="settings-section" aria-labelledby="devices-title" data-setting-field="security/devices" tabIndex={-1}>
      <h2 id="devices-title">Signed-in devices</h2>
      <p className="help-text">Every browser signed in to Caduceus. Revoking one signs it out at once.</p>
      <ul className="settings-list">
        {sessions.map((session) => {
          const label = deviceLabel(session.userAgent);
          return (
            <li key={session.id} className="settings-row">
              <div className="settings-row-text">
                <strong>
                  {label} {session.current && <span className="tag">This device</span>}
                </strong>
                <span className="help-text">
                  Signed in {dateTime.format(Date.parse(session.createdAt))} · Last seen {session.current ? 'now' : ago(session.lastSeenAt)}
                </span>
              </div>
              <div className="settings-actions">
                <WriteButton type="button" className="btn btn--secondary" aria-label={session.current ? 'Sign out this device' : `Revoke ${label}`} onClick={() => revoke(session)}>
                  {session.current ? 'Sign out' : 'Revoke'}
                </WriteButton>
              </div>
            </li>
          );
        })}
      </ul>
      {others.length > 1 && (
        <div className="settings-actions">
          <WriteButton type="button" className="btn btn--secondary" onClick={revokeOthers}>
            Sign out every other device
          </WriteButton>
        </div>
      )}
    </section>
  );
}

/** The devices that are sent notifications (M2 #03). Revoking one stops them at once; the device can turn them on again from Settings › Notifications. */
function NotificationDevicesSection({ devices, change, announce }: SectionProps & { devices: PushDevice[] }) {
  const revoke = (device: PushDevice) =>
    void change(async () => {
      const confirmed = await confirmTier({
        tier: 'T1',
        moduleId: 'security',
        action: 'push.revoke',
        label: device.current ? 'Stop notifications on this device?' : `Stop notifications on ${device.name}?`,
        text: 'No more push notifications are sent to it. It can turn them on again from Settings › Notifications.',
        object: device.name,
        confirmLabel: 'Stop notifications',
      });
      if (!confirmed) return undefined;
      const res = await fetch(`/_caduceus/api/push/subscriptions/${encodeURIComponent(device.id)}`, { method: 'DELETE' });
      const failure = await refusal(res);
      if (!failure) announce(`Notifications stopped on ${device.name}.`);
      return failure;
    });

  return (
    <section className="settings-section" aria-labelledby="push-devices-title">
      <h2 id="push-devices-title">Notification devices</h2>
      <p className="help-text">The devices that are sent <Term id="push-subscription">push notifications</Term>. Each one chooses what it hears of in Settings › Notifications.</p>
      {devices.length === 0 && <p className="help-text">No device is subscribed.</p>}
      <ul className="settings-list">
        {devices.map((device) => (
          <li key={device.id} className="settings-row">
            <div className="settings-row-text">
              <strong>
                {device.name} {device.current && <span className="tag">This device</span>}
              </strong>
              <span className="help-text">
                Subscribed {dateTime.format(device.createdAt)} · {device.lastSentAt === undefined ? 'nothing sent yet' : `last sent ${dateTime.format(device.lastSentAt)}`}
              </span>
            </div>
            <div className="settings-actions">
              <WriteButton type="button" className="btn btn--secondary" aria-label={`Revoke notifications on ${device.name}`} onClick={() => revoke(device)}>
                Revoke
              </WriteButton>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
