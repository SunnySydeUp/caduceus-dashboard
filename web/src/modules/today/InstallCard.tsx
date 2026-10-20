import { Icon } from '../../icons.tsx';
import { dismissInstallOffer, promptInstall, useInstallOffer } from '../../shell/install.ts';

/** First-run Today's Install card, for browsers that can install the app with one tap. "Not now" is remembered on this device; Settings › Install keeps the button. */
export function InstallCard() {
  const offer = useInstallOffer();
  if (offer.today !== 'install') return null;
  return (
    <section className="banner" data-tone="info" aria-labelledby="today-install-title">
      <Icon name="download" />
      <div className="banner__content">
        <div className="banner__title" id="today-install-title">
          Install Caduceus
        </div>
        <div className="banner__body">Open it from your Home Screen or dock like any other app. It starts faster and opens in its own window.</div>
        <div className="banner__actions">
          <button type="button" className="btn btn--primary btn--sm" onClick={() => void promptInstall()}>
            Install
          </button>
          <button type="button" className="btn btn--ghost btn--sm" onClick={dismissInstallOffer}>
            Not now
          </button>
        </div>
      </div>
      <span />
    </section>
  );
}
