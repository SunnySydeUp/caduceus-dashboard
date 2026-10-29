// Which profile a stored session belongs to (talk audit #3, #4). Every Hermes profile has its own sessions, so `/chat/<id>` with the wrong (or no) `?profile=`
// gets a 404 for a session that exists. Before the page says a conversation is gone, it asks the other profiles. No DOM and no React.

/**
 * Hermes's answer for a session it does not have in that profile: `Session not found` (404), or `Session store is not initialized` (503) for a profile that has never
 * had a session, which therefore cannot hold this one.
 */
export const isSessionMissing = (error: unknown): boolean => error instanceof Error && /session not found|answered 404|session store is not initialized/i.test(error.message);

export type SessionHome =
  /** The session is in `profile`. */
  | { kind: 'found'; profile: string }
  /** Every profile said it has no such session. */
  | { kind: 'missing' }
  /** Some profile could not be asked, and none of the others has it: the session may still exist. */
  | { kind: 'unknown' };

/**
 * Looks for session `storedId` in the profiles other than `tried` (which already said no), all at once. The first profile in the list that has it wins, so the answer
 * does not depend on which one Hermes answers first.
 */
export async function findSessionHome(rest: (path: string) => Promise<unknown>, { storedId, tried, profiles }: { storedId: string; tried: string; profiles: readonly string[] }): Promise<SessionHome> {
  const others = profiles.filter((name) => name !== tried);
  const answers = await Promise.allSettled(others.map((name) => rest(`/api/sessions/${encodeURIComponent(storedId)}?profile=${encodeURIComponent(name)}`)));
  const at = answers.findIndex((answer) => answer.status === 'fulfilled');
  const home = others[at];
  if (home !== undefined) return { kind: 'found', profile: home };
  return answers.every((answer) => answer.status === 'rejected' && isSessionMissing(answer.reason)) ? { kind: 'missing' } : { kind: 'unknown' };
}
