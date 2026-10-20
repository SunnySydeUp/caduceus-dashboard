import { Icon } from '../../icons.tsx';
import { StatusBadge } from '../../shell/StatusBadge.tsx';
import type { Portal } from './keys-model.ts';

/**
 * The Nous Portal account of the profile, as Hermes reports it. Read-only by design: Caduceus has no billing or subscription action, and
 * the proxy refuses every billing and subscription call. The one way to change a plan is Nous's own site, which opens in the browser.
 */
export function PortalCard({ profile, portal }: { profile: string; portal: Portal }) {
  const tier = portal.freeTier ? 'Free tier' : portal.accountTier ? `${portal.accountTier} plan` : undefined;
  return (
    <section className="ky-section" aria-labelledby="ky-portal">
      <div className="ky-section__head">
        <h2 className="ky-section__title" id="ky-portal">
          <Icon name="bolt" />
          Nous Portal
        </h2>
      </div>
      <div className="ky-card ky-portal" data-signed-in={portal.loggedIn}>
        <div className="ky-card__top">
          <div className="ky-card__id">
            <h3 className="ky-card__name">Account of {profile}</h3>
            <p className="ky-card__sub">
              {portal.loggedIn ? 'Signed in to Nous Portal.' : 'Not signed in to Nous Portal. Connect it under Account sign-ins.'}
              {portal.provider === 'nous' && ' Nous is the provider of the chat model.'}
            </p>
          </div>
          <StatusBadge state={portal.loggedIn ? 'online' : 'offline'} label={portal.loggedIn ? 'Signed in' : 'Not signed in'} variant="plain" />
        </div>
        {portal.loggedIn && tier && (
          <div className="ky-card__tags">
            <span className="tag" data-tone="accent">
              {tier}
            </span>
          </div>
        )}
        {portal.features.length > 0 && (
          <dl className="ky-portal__features" aria-label="How the tool gateway is routed">
            {portal.features.map((feature) => (
              <div key={feature.label} className="ky-portal__feature">
                <dt>{feature.label}</dt>
                <dd>{feature.state}</dd>
              </div>
            ))}
          </dl>
        )}
        <p className="ky-note">Read-only. Subscribing, changing a plan and billing are made on Nous’s own site: Caduceus cannot make them, and its proxy refuses every billing call.</p>
        {portal.subscriptionUrl && (
          <div className="ky-card__actions">
            <a className="btn btn--secondary btn--sm" href={portal.subscriptionUrl} target="_blank" rel="noreferrer noopener">
              <Icon name="external" small />
              Manage subscription on Nous
            </a>
          </div>
        )}
      </div>
    </section>
  );
}
