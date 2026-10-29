import { Icon } from '../../icons.tsx';
import { useOnline } from '../../shell/connection.ts';
import { dismissInstallOffer, promptInstall, useInstallOffer } from '../../shell/install.ts';
import { useAppNavigate } from '../../shell/navigation.tsx';
import { toast } from '../../shell/toasts.ts';

/** First-run Today's Install card, for browsers that can install the app with one tap. "Not now" is remembered on this device; Settings › Install app keeps the button, and says so. */
export function InstallCard() {
  const offer = useInstallOffer();
  const navigate = useAppNavigate();
  const online = useOnline();
  // Installing fetches the app's manifest and icons: offline it would fail, so the offer waits (Settings › Install app is still there).
  if (offer.today !== 'install' || !online) return null;
  const notNow = () => {
    dismissInstallOffer();
    toast('Install stays in Settings', { detail: 'Settings › Install app keeps the button, whenever you want it.', action: { label: 'Open', onClick: () => void navigate('/settings/install') } });
  };
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
          <button type="button" className="btn btn--ghost btn--sm" onClick={notNow}>
            Not now
          </button>
        </div>
      </div>
      <span />
    </section>
  );
}
