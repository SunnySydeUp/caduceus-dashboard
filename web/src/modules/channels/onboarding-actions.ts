// What the QR onboarding sheet changes in Hermes (M5 #03), each through `fetchTiered` with the tier the policy map gives the route: starting a pairing is T1, saving the allowed
// users (which writes the credentials and turns the platform on) T2, cancelling T0. Polling is a plain read in the sheet. Caduceus keeps nothing of the pairing.
import { raiseRestartNeeded } from '../../restart-to-apply.ts';
import { fetchTiered } from '../../tiered.ts';
import { runTiered, type ActionOutcome } from '../profiles/profile-actions.ts';
import { readSaveAnswer } from './channels-model.ts';
import { onboardingRequests, readOnboarding, type OnboardingState, type QrPlatform } from './qr-onboarding.ts';

const NAME: Record<QrPlatform, string> = { telegram: 'Telegram', whatsapp: 'WhatsApp' };

/** Starts a pairing (T1: the owner confirms) and says what Hermes made of it. */
export async function startOnboarding(platform: QrPlatform, profile: string): Promise<ActionOutcome<OnboardingState>> {
  const outcome = await runTiered(
    fetchTiered({
      ...onboardingRequests.start(platform, profile),
      confirm:
        platform === 'telegram'
          ? { title: 'Create a Telegram bot with a QR?', text: 'Hermes asks Nous’s setup service for a new bot and shows a QR to scan with Telegram. Nothing is saved until you choose who may talk to the agent.', object: 'Telegram', profile, confirmLabel: 'Show the QR' }
          : { title: 'Pair WhatsApp with a QR?', text: 'Hermes starts its WhatsApp bridge, which shows a QR to scan from WhatsApp’s Linked devices. Nothing is enabled until you choose who may talk to the agent.', object: 'WhatsApp', profile, confirmLabel: 'Show the QR' },
    }),
  );
  if (outcome.kind !== 'done') return outcome;
  const state = readOnboarding(platform, outcome.body);
  return state ? { kind: 'done', body: state } : { kind: 'failed', message: `Hermes did not start the ${NAME[platform]} setup as expected.` };
}

/** Saves who may talk to the agent and turns the platform on (T2: a passkey), then raises the restart notice if the gateway has to restart. */
export async function applyOnboarding(platform: QrPlatform, pairingId: string, profile: string, users: string[]): Promise<ActionOutcome<{ needsRestart: boolean }>> {
  const outcome = await runTiered(
    fetchTiered({
      ...onboardingRequests.apply(platform, pairingId, profile, users),
      confirm: {
        title: `Allow ${users.length === 0 ? 'the people already allowed' : users.length === 1 ? 'this person' : `these ${users.length} people`} on ${NAME[platform]} for ${profile}?`,
        text: `Hermes saves the ${NAME[platform]} credentials and the list of people who may talk to the agent${users.length ? `: ${users.join(', ')}` : ''}, turns the platform on and restarts the gateway.`,
        object: NAME[platform],
        profile,
        confirmLabel: 'Save and turn on',
      },
    }),
  );
  if (outcome.kind !== 'done') return outcome;
  const saved = readSaveAnswer(outcome.body);
  if (saved.needsRestart) await raiseRestartNeeded(profile, `${NAME[platform]} set up with a QR`);
  return { kind: 'done', body: saved };
}

/** Ends a pairing (T0). Hermes forgets it; a Telegram pairing saved nothing, and a WhatsApp device that was linked stays linked in Hermes's session folder. */
export async function cancelOnboarding(platform: QrPlatform, pairingId: string): Promise<void> {
  await fetchTiered(onboardingRequests.cancel(platform, pairingId)).catch(() => undefined);
}
