// The changes Connect › Pairing makes in Hermes, each through `fetchTiered` with the tier the policy map gives the route (approve and
// revoke T2, clear pending T1). The caller shows toasts and reloads; this says what happened. Caduceus keeps nothing of what it sends.
import { fetchTiered } from '../../tiered.ts';
import { runTiered, type ActionOutcome } from '../profiles/profile-actions.ts';
import { approveRequest, clearPending, platformName, revokeUser, type ApprovedUser, type PendingRequest } from './pairing-model.ts';

/** How a person is named in a dialog: their name when they have one, and always their id on the platform. */
export const personWords = (person: { userName: string; userId: string }): string => (person.userName ? `${person.userName} (${person.userId})` : person.userId);

/** Approves a pending request by its id (T2). Hermes adds the person to the platform's allowed users, so the bot answers them from then on. */
export function approvePending(request: PendingRequest, profile: string): Promise<ActionOutcome> {
  const send = approveRequest(request, profile);
  return runTiered(
    fetchTiered({
      ...send,
      confirm: {
        title: `Approve ${personWords(request)} on ${platformName(request.platform)} for ${profile}?`,
        text: `The ${platformName(request.platform)} bot of ${profile} starts answering this person, with everything this profile’s agent can do.`,
        object: request.userName || request.userId,
        profile,
        confirmLabel: 'Approve person',
      },
    }),
  );
}

/** Revokes an approved user (T2): the bot stops answering them, and Hermes takes them off the platform’s allowed users. */
export function revokeApproved(user: ApprovedUser, profile: string): Promise<ActionOutcome> {
  const send = revokeUser(user, profile);
  return runTiered(
    fetchTiered({
      ...send,
      confirm: {
        title: `Revoke ${personWords(user)} on ${platformName(user.platform)} for ${profile}?`,
        text: `The ${platformName(user.platform)} bot of ${profile} stops answering this person. They can ask to be paired again.`,
        object: user.userName || user.userId,
        profile,
        confirmLabel: 'Revoke person',
      },
    }),
  );
}

/** Drops every pending request of the profile (T1). Nobody who is approved is touched. */
export function clearPendingRequests(count: number, profile: string): Promise<ActionOutcome<{ cleared?: number }>> {
  const send = clearPending(profile);
  return runTiered(
    fetchTiered({
      ...send,
      confirm: {
        title: `Clear ${count === 1 ? 'the pending request' : `all ${count} pending requests`} for ${profile}?`,
        text: 'The people who asked are not told. They can ask again after Hermes’s ten-minute wait. Approved people stay approved.',
        profile,
        confirmLabel: 'Clear pending',
      },
    }),
  );
}
