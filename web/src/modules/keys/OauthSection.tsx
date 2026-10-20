import { useId, useState } from 'react';
import { Icon } from '../../icons.tsx';
import { StatusBadge, type StatusState } from '../../shell/StatusBadge.tsx';
import { Term } from '../../shell/Term.tsx';
import { toast } from '../../shell/toasts.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { CopyText } from '../webhooks/CopyText.tsx';
import type { DeviceCode, OauthProvider } from './keys-model.ts';
import { disconnectProvider, startSignIn } from './oauth-actions.ts';
import { SignInSheet } from './SignInSheet.tsx';
import './keys.css';
import './oauth.css';

const DAY_MS = 24 * 60 * 60 * 1000;

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

/** Device-code providers first, then the ones signed in, then by name. */
function byUse(a: OauthProvider, b: OauthProvider): number {
  const flow = Number(b.flow === 'device_code') - Number(a.flow === 'device_code');
  return flow || Number(b.loggedIn) - Number(a.loggedIn) || a.name.localeCompare(b.name);
}

/** How a login stands: signed in (and until when), about to lapse, lapsed, or not signed in. */
function standing(provider: OauthProvider, now: number): { badges: { state: StatusState; label: string }[]; until: string | undefined } {
  if (!provider.loggedIn) return { badges: [{ state: 'offline', label: 'Not signed in' }], until: undefined };
  const at = provider.expiresAt ? Date.parse(provider.expiresAt) : NaN;
  if (Number.isNaN(at)) return { badges: [{ state: 'online', label: 'Signed in' }], until: undefined };
  const until = new Date(at).toLocaleString();
  if (at < now) return { badges: [{ state: 'offline', label: 'Expired' }], until: undefined };
  if (at - now < DAY_MS) return { badges: [{ state: 'online', label: 'Signed in' }, { state: 'degraded', label: 'Expires soon' }], until };
  return { badges: [{ state: 'online', label: 'Signed in' }], until };
}

function ProviderCard({ provider, busy, onConnect, onDisconnect }: { provider: OauthProvider; busy: boolean; onConnect(): void; onDisconnect(): void }) {
  const { badges, until } = standing(provider, Date.now());
  const site = webAddress(provider.docsUrl);
  const device = provider.flow === 'device_code';
  return (
    <li className="ky-card">
      <div className="ky-card__top">
        <div className="ky-card__id">
          <h3 className="ky-card__name">{provider.name}</h3>
          <div className="ky-oa-status">
            {badges.map((badge) => (
              <StatusBadge key={badge.label} state={badge.state} label={badge.label} variant="plain" />
            ))}
          </div>
        </div>
      </div>
      {until && <p className="ky-card__sub">Until {until}</p>}
      {provider.sourceLabel && (
        <div className="ky-card__tags">
          <span className="tag">{provider.sourceLabel}</span>
        </div>
      )}
      {provider.error && (
        <p className="ky-oa-warn">
          <Icon name="alert" small />
          <span>Hermes reports: {provider.error}</span>
        </p>
      )}
      {!device && (
        <>
          <p className="ky-note">Hermes cannot sign in to this provider; another program owns the login.</p>
          {provider.cliCommand && (
            <div className="ky-oa-cli">
              <code className="ky-url mono">{provider.cliCommand}</code>
              <CopyText text={provider.cliCommand} what={`the sign-in command for ${provider.name}`} label="Copy command" />
            </div>
          )}
          {provider.disconnectHint && <p className="ky-note">{provider.disconnectHint}</p>}
        </>
      )}
      <div className="ky-card__actions">
        {device && (
          <WriteButton type="button" className="btn btn--primary" disabled={busy} aria-busy={busy} aria-label={`${provider.loggedIn ? 'Reconnect' : 'Connect'} ${provider.name}`} onClick={onConnect}>
            <Icon name={provider.loggedIn ? 'refresh' : 'link'} />
            {provider.loggedIn ? 'Reconnect' : 'Connect'}
          </WriteButton>
        )}
        {device && provider.loggedIn && provider.disconnectable && (
          <WriteButton type="button" className="btn btn--secondary btn--danger-quiet" disabled={busy} aria-label={`Disconnect ${provider.name}`} onClick={onDisconnect}>
            <Icon name="trash" />
            Disconnect
          </WriteButton>
        )}
        {site && (
          <a className="btn btn--secondary" href={site} target="_blank" rel="noreferrer noopener" aria-label={`Open provider site of ${provider.name}`}>
            <Icon name="external" />
            Open provider site
          </a>
        )}
      </div>
    </li>
  );
}

/** System › Keys › Account sign-ins: the providers that sign in with an account, and what Hermes says of each login. */
export function OauthSection({ profile, providers, onChanged }: { profile: string; providers: OauthProvider[]; onChanged(): Promise<void> }) {
  const headingId = useId();
  const [busy, setBusy] = useState<string>();
  const [signing, setSigning] = useState<{ provider: OauthProvider; code: DeviceCode }>();

  const connect = async (provider: OauthProvider) => {
    setBusy(provider.id);
    const outcome = await startSignIn(provider, profile);
    setBusy(undefined);
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    if (outcome.kind === 'done') setSigning({ provider, code: outcome.body });
  };

  const disconnect = async (provider: OauthProvider) => {
    setBusy(provider.id);
    const outcome = await disconnectProvider(provider, profile);
    setBusy(undefined);
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    if (outcome.kind === 'done') {
      await onChanged();
      toast(`Disconnected ${provider.name}`, { detail: `Signed out for ${profile}.` });
    }
  };

  return (
    <section className="ky-section" aria-labelledby={headingId}>
      <h2 className="ky-section__title" id={headingId}>
        <Icon name="user" />
        Account sign-ins
        <span className="ky-section__count">{providers.length}</span>
      </h2>
      <p className="ky-section__lead">
        Some providers sign in with an account instead of a key. Hermes asks the provider for a <Term id="device-code">device code</Term>, you approve it on the provider’s page, and Hermes keeps the login for this profile.
      </p>
      {providers.length === 0 ? (
        <div className="empty">
          <span className="empty__icon">
            <Icon name="user" />
          </span>
          <p>No account sign-ins.</p>
          <p>Hermes lists no provider that signs in with an account.</p>
        </div>
      ) : (
        <ul className="ky-cards" aria-label="Account sign-ins">
          {[...providers].sort(byUse).map((provider) => (
            <ProviderCard key={provider.id} provider={provider} busy={busy === provider.id} onConnect={() => void connect(provider)} onDisconnect={() => void disconnect(provider)} />
          ))}
        </ul>
      )}
      {signing && (
        <SignInSheet
          provider={signing.provider}
          code={signing.code}
          profile={profile}
          onFinished={() => void onChanged()}
          onClose={() => setSigning(undefined)}
        />
      )}
    </section>
  );
}
