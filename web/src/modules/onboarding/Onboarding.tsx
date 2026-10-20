// The first-sign-in wizard (M5 #16): four steps (checks, a provider, a default workspace, notifications), one on screen at a time, with Back and Continue in a
// bar that stays at the foot of the screen on a phone. The step the owner is on is saved on the Caduceus server after every move, so leaving and coming back,
// on this device or another, resumes there. Nothing blocks: every step can be left as it is, and the whole wizard can be skipped and reopened from Settings.
import { useEffect, useRef, useState } from 'react';
import { ONBOARDING_STEPS, type OnboardingStep } from '@caduceus/contracts/onboarding';
import { Icon } from '../../icons.tsx';
import { useAppNavigate } from '../../shell/navigation.tsx';
import { PageHeader } from '../../shell/PageHeader.tsx';
import { useProfileScope } from '../../shell/profile-context.tsx';
import { Term } from '../../shell/Term.tsx';
import { toast } from '../../shell/toasts.ts';
import { loadOnboarding, saveOnboarding, useOnboarding } from './onboarding-progress.ts';
import { useSetupChecks } from './setup-data.ts';
import { StepChecks } from './StepChecks.tsx';
import { StepNotifications } from './StepNotifications.tsx';
import { StepProvider } from './StepProvider.tsx';
import { StepWorkspace } from './StepWorkspace.tsx';
import './onboarding.css';

const STEP_TITLES: Record<OnboardingStep, string> = {
  checks: 'Checks',
  provider: 'Provider',
  workspace: 'Workspace',
  notifications: 'Notifications',
};

const STEP_HEADINGS: Record<OnboardingStep, string> = {
  checks: 'Is everything ready?',
  provider: 'Set up a provider',
  workspace: 'Choose a default workspace',
  notifications: 'Be told when you are needed',
};

function Wizard({ profile }: { profile: string }) {
  const navigate = useAppNavigate();
  const progress = useOnboarding();
  const setup = useSetupChecks(profile);
  const [failed, setFailed] = useState(false);
  /** The progress has been asked of the server since this screen opened: another device may have moved it since the page last heard. */
  const [fresh, setFresh] = useState(false);
  const [problem, setProblem] = useState<string>();
  const [busy, setBusy] = useState(false);
  /** Finishing has been saved and the screen is on its way to Today: it keeps showing the step it was on. */
  const leaving = useRef(false);
  const reopened = useRef(false);

  const ask = () => {
    setFailed(false);
    void loadOnboarding(undefined, true).then((loaded) => (loaded === undefined ? setFailed(true) : setFresh(true)));
  };
  useEffect(ask, []);

  // Opening the wizard is starting or resuming it, whether it was new, skipped or finished: from the step it was left on, or the first after a finish.
  useEffect(() => {
    if (!progress || !fresh || reopened.current) return;
    // Only the progress this screen opened with decides: finishing or skipping later must not be taken for a reopening.
    reopened.current = true;
    if (progress.state === 'in-progress') return;
    saveOnboarding({ state: 'in-progress', step: progress.state === 'finished' ? 'checks' : progress.step }).catch((error: unknown) => setProblem(error instanceof Error ? error.message : 'Caduceus did not save your place.'));
  }, [progress, fresh]);

  if (!progress || !fresh) {
    return failed ? (
      <div className="banner" data-tone="danger" role="alert">
        <Icon name="alert" />
        <span className="banner__content">Caduceus did not answer, so your setup progress could not be read.</span>
        <button type="button" className="btn btn--secondary btn--sm" onClick={ask}>
          <Icon name="refresh" />
          Retry
        </button>
      </div>
    ) : (
      <p role="status">Loading…</p>
    );
  }

  // A finished wizard opens again at its first step; until that is saved, that is what shows.
  const step = progress.state === 'finished' && !leaving.current ? 'checks' : progress.step;
  const index = ONBOARDING_STEPS.indexOf(step);
  const last = index === ONBOARDING_STEPS.length - 1;

  const go = async (to: OnboardingStep) => {
    setProblem(undefined);
    try {
      await saveOnboarding({ state: 'in-progress', step: to });
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Caduceus did not save your place.');
    }
  };

  const skip = async () => {
    try {
      await saveOnboarding({ state: 'skipped', step });
    } catch (error) {
      return setProblem(error instanceof Error ? error.message : 'Caduceus did not save that.');
    }
    toast('Setup skipped', { detail: 'Open the setup guide from Settings to carry on where you left off.' });
    await navigate('/');
  };

  const complete = async () => {
    setBusy(true);
    try {
      leaving.current = true;
      await saveOnboarding({ state: 'finished', step });
      toast('Setup finished', { tone: 'success', detail: 'Open the setup guide from Settings to run it again.' });
      await navigate('/');
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Caduceus did not save that.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ob">
      <PageHeader
        title="Set up Caduceus"
        subtitle={
          <>
            A short <Term id="onboarding">setup guide</Term> for the first time. Stop at any point: it remembers where you were.
          </>
        }
        actions={
          <button type="button" className="btn btn--ghost" onClick={() => void skip()}>
            Skip setup
          </button>
        }
      />
      <nav aria-label="Setup steps">
        <p className="ob-progress">
          <span className="ob-progress__count">
            Step {index + 1} of {ONBOARDING_STEPS.length}
          </span>
          <span aria-hidden="true"> · </span>
          <span>{STEP_TITLES[step]}</span>
        </p>
        <ol className="ob-steps">
          {ONBOARDING_STEPS.map((id, at) => (
            <li key={id} className="ob-steps__item" data-state={at < index ? 'done' : at === index ? 'current' : 'next'}>
              <button type="button" className="ob-steps__button" aria-current={id === step ? 'step' : undefined} onClick={() => void go(id)}>
                <span className="ob-steps__mark" aria-hidden="true">
                  {at < index ? <Icon name="check" small /> : at + 1}
                </span>
                <span className="ob-steps__label">{STEP_TITLES[id]}</span>
              </button>
            </li>
          ))}
        </ol>
      </nav>
      <section className="ob-step" aria-labelledby="ob-step-title">
        <h2 id="ob-step-title" className="ob-step__title">
          {STEP_HEADINGS[step]}
        </h2>
        {step === 'checks' && <StepChecks setup={setup} />}
        {step === 'provider' && <StepProvider profile={profile} setup={setup} />}
        {step === 'workspace' && <StepWorkspace profile={profile} />}
        {step === 'notifications' && <StepNotifications />}
        {problem && (
          <p className="ob-problem" role="alert">
            <Icon name="alert" small /> {problem}
          </p>
        )}
      </section>
      <div className="ob-bar">
        {index > 0 && (
          <button type="button" className="btn btn--secondary" onClick={() => void go(ONBOARDING_STEPS[index - 1]!)}>
            <Icon name="chev-l" />
            Back
          </button>
        )}
        {last ? (
          <button type="button" className="btn btn--primary ob-bar__primary" disabled={busy} aria-busy={busy} onClick={() => void complete()}>
            Finish setup
          </button>
        ) : (
          <button type="button" className="btn btn--primary ob-bar__primary" onClick={() => void go(ONBOARDING_STEPS[index + 1]!)}>
            Continue
            <Icon name="arrow-r" />
          </button>
        )}
      </div>
    </div>
  );
}

/** The setup wizard: scoped to the profile this tab works on, because the provider, the model and the default folder are that profile's. */
export function Onboarding() {
  const { effective } = useProfileScope();
  return effective ? <Wizard key={effective.name} profile={effective.name} /> : <p role="status">Loading…</p>;
}
