// Branching a STORED session (M1 #12, #17): a chat that is open here already has a runtime session, but the row menu's Duplicate and a read-only chat's
// Branch start from a stored id alone. Hermes branches only a live session (`session.branch`), so the stored one is attached for the branch, and
// let go again if this call was what attached it. No DOM and no React.
import { CADUCEUS_SESSION_SOURCE } from '@caduceus/contracts/caduceus-api';
import type { SessionActiveListResult, SessionBranchResult, SessionResumeResult } from '@caduceus/contracts/hermes/gateway';

export interface BranchClient {
  request<Result>(method: string, params: Record<string, unknown>): Promise<Result>;
}

/**
 * Continues the stored session `storedId` in a new stored session that has its whole history, and resolves with the new one. The original is untouched.
 * It is resumed (`session.resume`, without its messages) and branched from the runtime id that gives; that runtime is closed again (`session.close`) unless
 * Hermes already hosted the session for another tab or page, which keeps its own. Rejects with Hermes's words when it refuses (a turn is running, nothing to branch).
 */
export async function branchStored(client: BranchClient, { storedId, profile }: { storedId: string; profile: string | undefined }): Promise<{ storedId: string; title: string }> {
  const scope = profile === undefined ? {} : { profile };
  const hosted = await client.request<SessionActiveListResult>('session.active_list', scope).then(
    (list) => list.sessions.some((live) => live.session_key === storedId),
    () => false,
  );
  const attached = await client.request<SessionResumeResult>('session.resume', { session_id: storedId, omit_messages: true, source: CADUCEUS_SESSION_SOURCE, ...scope });
  try {
    const branch = await client.request<SessionBranchResult>('session.branch', { session_id: attached.session_id, ...scope });
    return { storedId: branch.stored_session_id, title: branch.title };
  } finally {
    if (!hosted) await client.request('session.close', { session_id: attached.session_id, ...scope }).catch(() => undefined);
  }
}
