import { ONBOARDING_STEPS } from '@caduceus/contracts/onboarding';
import { Icon } from '../../icons.tsx';
import { useOnline } from '../../shell/connection.ts';
import { dismissInstallOffer, promptInstall, useInstallOffer } from '../../shell/install.ts';
import { AppLink, useAppNavigate } from '../../shell/navigation.tsx';
import { toast } from '../../shell/toasts.ts';
import { saveOnboarding, useOnboarding } from '../onboarding/onboarding-progress.ts';

/**
 * Today's one first-run card. Two things are offered to a new owner, the setup guide (M5 #16) and installing the app, and they are one card with one primary action: setup first,
 * since an unfinished setup matters more than a shortcut to the Home Screen. While setup is open, installing is the card's secondary action (when the browser can install);
 * once setup is done or set aside, the card offers installing on its own. It is an offer, not a gate: each "Not now" is remembered (setup on the server for every device,
 * installing on this device, with Settings › Install app keeping the button), and nothing else on Today waits for it.
 * It waits for the server to say where setup stands, so that it never opens as the install offer and then turns into the setup one. Installing fetches the app's manifest and icons,
 * so offline the install offer waits.
 */
export function FirstRunCard() {
  const progress = useOnboarding();
  const offer = useInstallOffer();
  const online = useOnline();
  const navigate = useAppNavigate();
  if (!progress) return null;
  const setup = progress.state === 'new' || progress.state === 'in-progress';
  const install = offer.today === 'install' && online;
  if (!setup && !install) return null;
  const resuming = progress.state === 'in-progress';
  const skipSetup = () =>
    saveOnboarding({ state: 'skipped', step: progress.step }).then(
      () => toast('Setup skipped', { detail: 'Open the setup guide from Settings any time.' }),
      (error: unknown) => toast(error instanceof Error ? error.message : 'Caduceus did not save that.', { tone: 'danger' }),
    );
  const skipInstall = () => {
    dismissInstallOffer();
    toast('Install stays in Settings', { detail: 'Settings › Install app keeps the button, whenever you want it.', action: { label: 'Open', onClick: () => void navigate('/settings/install') } });
  };
  return (
    <section className="banner" data-tone="info" aria-labelledby="today-first-run-title">
      <Icon name={setup ? 'flag' : 'download'} />
      <div className="banner__content">
        <div className="banner__title" id="today-first-run-title">
          {setup ? (resuming ? 'Finish setting up Caduceus' : 'Set up Caduceus') : 'Install Caduceus'}
        </div>
        <div className="banner__body">
          {setup
            ? resuming
              ? `You stopped at step ${ONBOARDING_STEPS.indexOf(progress.step) + 1} of ${ONBOARDING_STEPS.length}. It carries on from there, on any device.`
              : 'A few checks, a provider, a default folder and notifications. It takes a couple of minutes, and you can stop at any point.'
            : 'Open it from your Home Screen or dock like any other app. It starts faster and opens in its own window.'}
        </div>
        <div className="banner__actions">
          {setup ? (
            <AppLink className="btn btn--primary btn--sm" to="/onboarding">
              {resuming ? 'Continue setup' : 'Start setup'}
            </AppLink>
          ) : (
            <button type="button" className="btn btn--primary btn--sm" onClick={() => void promptInstall()}>
              Install
            </button>
          )}
          {setup && install && (
            <button type="button" className="btn btn--secondary btn--sm" onClick={() => void promptInstall()}>
              Install the app
            </button>
          )}
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => void (setup ? skipSetup() : skipInstall())}>
            Not now
          </button>
        </div>
      </div>
      <span />
    </section>
  );
}
