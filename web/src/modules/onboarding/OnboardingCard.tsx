import { ONBOARDING_STEPS } from '@caduceus/contracts/onboarding';
import { Icon } from '../../icons.tsx';
import { AppLink } from '../../shell/navigation.tsx';
import { toast } from '../../shell/toasts.ts';
import { saveOnboarding, useOnboarding } from './onboarding-progress.ts';

/**
 * Today's offer of the setup guide (M5 #16) until the owner has finished it or set it aside. It is an offer on the page, not a gate: Not now skips it for good
 * (Settings › Setup guide opens it again), and nothing else on Today waits for it. It shows only once the server has said where the owner stands.
 */
export function OnboardingCard() {
  const progress = useOnboarding();
  if (!progress || (progress.state !== 'new' && progress.state !== 'in-progress')) return null;
  const resuming = progress.state === 'in-progress';
  const dismiss = () =>
    saveOnboarding({ state: 'skipped', step: progress.step }).then(
      () => toast('Setup skipped', { detail: 'Open the setup guide from Settings any time.' }),
      (error: unknown) => toast(error instanceof Error ? error.message : 'Caduceus did not save that.', { tone: 'danger' }),
    );
  return (
    <section className="banner" data-tone="info" aria-labelledby="today-onboarding-title">
      <Icon name="flag" />
      <div className="banner__content">
        <div className="banner__title" id="today-onboarding-title">
          {resuming ? 'Finish setting up Caduceus' : 'Set up Caduceus'}
        </div>
        <div className="banner__body">
          {resuming ? `You stopped at step ${ONBOARDING_STEPS.indexOf(progress.step) + 1} of ${ONBOARDING_STEPS.length}. It carries on from there, on any device.` : 'A few checks, a provider, a default folder and notifications. It takes a couple of minutes, and you can stop at any point.'}
        </div>
        <div className="banner__actions">
          <AppLink className="btn btn--primary btn--sm" to="/onboarding">
            {resuming ? 'Continue setup' : 'Start setup'}
          </AppLink>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => void dismiss()}>
            Not now
          </button>
        </div>
      </div>
      <span />
    </section>
  );
}
