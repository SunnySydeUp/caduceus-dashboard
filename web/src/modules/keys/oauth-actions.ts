// The changes System › Keys › Account sign-ins makes in Hermes, each through `fetchTiered` with the tier the policy map gives it (start T1,
// disconnect T2, cancelling a waiting sign-in T0). The caller shows toasts and reloads; this says what happened. Hermes holds the tokens:
// nothing here ever has one, and the page keeps nothing of a sign-in beyond the code a person types in at the provider.
import { fetchTiered } from '../../tiered.ts';
import { runTiered, type ActionOutcome } from '../profiles/profile-actions.ts';
import { oauthCancelSession, oauthDisconnect, oauthPollPath, oauthStart, parseDeviceCode, type DeviceCode, type OauthProvider } from './keys-model.ts';

/** Starts a device-code sign-in (T1): Hermes asks the provider for a code and a link, and answers with them. */
export async function startSignIn(provider: OauthProvider, profile: string): Promise<ActionOutcome<DeviceCode>> {
  const outcome = await runTiered(
    fetchTiered({
      ...oauthStart(provider.id, profile),
      confirm: {
        title: `Start signing in to ${provider.name} for ${profile}?`,
        text: `Hermes asks ${provider.name} for a code. Nothing is saved until you approve the code on the provider’s page.`,
        object: provider.id,
        profile,
        confirmLabel: 'Get a code',
      },
    }),
  );
  if (outcome.kind !== 'done') return outcome;
  const code = parseDeviceCode(outcome.body);
  if (!code) return { kind: 'failed', message: 'Hermes did not give a code and a link to sign in with.' };
  return { kind: 'done', body: code };
}

/** Tells Hermes to stop waiting for a sign-in (T0). Best effort: Hermes forgets a sign-in by itself when its code runs out. */
export async function cancelSignIn(sessionId: string, profile: string): Promise<void> {
  try {
    await runTiered(fetchTiered(oauthCancelSession(sessionId, profile)));
  } catch {
    // Nothing waits on this: the code lapses on Hermes's side either way.
  }
}

/** Signs a provider out in the profile (T2): Hermes deletes the saved login. */
export function disconnectProvider(provider: OauthProvider, profile: string): Promise<ActionOutcome> {
  return runTiered(
    fetchTiered({
      ...oauthDisconnect(provider.id, profile),
      confirm: {
        title: `Disconnect ${provider.name} for ${profile}?`,
        text: 'Hermes signs the account out for this profile and deletes its saved login. Other profiles keep theirs. You can sign in again later.',
        object: provider.id,
        profile,
        confirmLabel: 'Disconnect',
        recoverability: { undoable: true, note: 'Connect again to sign back in.' },
      },
    }),
  );
}

/** One look at Hermes's record of a sign-in (a plain read), in the shape `followLogin` takes. */
export async function pollSignIn(provider: OauthProvider, code: DeviceCode, profile: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(oauthPollPath(provider.id, code.sessionId, profile));
  return { status: res.status, body: await res.json().catch(() => undefined) };
}
