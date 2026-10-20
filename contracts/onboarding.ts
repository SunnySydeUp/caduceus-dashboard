// The first-sign-in wizard's progress (M5 #16): which step the owner is on and whether they finished it or set it aside. It is shared by the server
// (which validates and keeps it for the owner, so any device resumes at the same step) and the web app (which draws the wizard). Hermes does not own it;
// that the owner finished is also written to Hermes (`profiles.remember_onboarding`), but progress is Caduceus's.

/** The wizard's steps, in order. */
export const ONBOARDING_STEPS = ['checks', 'provider', 'workspace', 'notifications'] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/** `new`: the owner has neither started nor skipped it (the Today card offers it). The others are what the owner chose. */
export type OnboardingState = 'new' | 'in-progress' | 'skipped' | 'finished';

export interface OnboardingProgress {
  state: OnboardingState;
  /** Where the wizard opens: the step the owner reached, kept when they skip, so reopening it carries on. */
  step: OnboardingStep;
}

export const NEW_ONBOARDING: OnboardingProgress = { state: 'new', step: 'checks' };

/** What the owner may save: a wizard that was begun, set aside or finished. `new` is only ever what has not been saved yet. */
const SAVED_STATES: Record<string, true> = { 'in-progress': true, skipped: true, finished: true };

/** `value` as progress that may be saved, only when its state and step are both ones that exist; otherwise `undefined`. */
export function parseOnboardingProgress(value: unknown): OnboardingProgress | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { state, step } = value as Record<string, unknown>;
  if (typeof state !== 'string' || !Object.hasOwn(SAVED_STATES, state) || !(ONBOARDING_STEPS as readonly unknown[]).includes(step)) return undefined;
  return { state: state as OnboardingState, step: step as OnboardingStep };
}

/** The progress as the page reads it back from the server's answer; a new owner's when the answer is not progress (a later version may add states). */
export function readOnboardingProgress(value: unknown): OnboardingProgress {
  return parseOnboardingProgress(value) ?? NEW_ONBOARDING;
}
