// What Connect › Pairing knows about direct-message pairing, free of the DOM and of React. It is made only of what Hermes answers
// (`GET /api/pairing`) and nothing is kept (D1: Hermes is the source of truth). Hermes never lists the one-time code a stranger was
// sent, only an id for the request, so the owner approves a request by that id and never sees or types a code.

/** A stranger's first message to a bot: a request waiting for the owner. */
export interface PendingRequest {
  platform: string;
  /** Hermes's id for the request; empty for a request an older Hermes wrote, which can only be approved with its code. */
  requestId: string;
  userId: string;
  userName: string;
  ageMinutes: number;
  /** The request has an id, so the page can approve it. */
  approvable: boolean;
}

/** A user the owner approved: the bot answers them. */
export interface ApprovedUser {
  platform: string;
  userId: string;
  userName: string;
  /** When they were approved (an ISO time), when Hermes says. */
  approvedAt: string | undefined;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

const text = (value: unknown): string => (typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '');

/** The two lists in Hermes's answer, in the order it gave them; an answer that is not made of lists is no requests. */
export function parsePairing(body: unknown): { pending: PendingRequest[]; approved: ApprovedUser[] } {
  const answer = record(body);
  const pending = (Array.isArray(answer.pending) ? answer.pending : []).flatMap((raw): PendingRequest[] => {
    const entry = record(raw);
    const platform = text(entry.platform);
    if (platform === '') return [];
    const requestId = text(entry.request_id);
    return [{ platform, requestId, userId: text(entry.user_id), userName: text(entry.user_name), ageMinutes: typeof entry.age_minutes === 'number' ? entry.age_minutes : 0, approvable: requestId !== '' }];
  });
  const approved = (Array.isArray(answer.approved) ? answer.approved : []).flatMap((raw): ApprovedUser[] => {
    const entry = record(raw);
    const platform = text(entry.platform);
    if (platform === '') return [];
    return [{ platform, userId: text(entry.user_id), userName: text(entry.user_name), approvedAt: typeof entry.approved_at === 'number' ? new Date(entry.approved_at * 1000).toISOString() : undefined }];
  });
  return { pending, approved };
}

/** Where Hermes lists a profile's pairing requests: each profile's gateway keeps its own store. */
export const pairingListPath = (profile: string) => `/api/pairing?profile=${encodeURIComponent(profile)}`;

/** A change the page sends to Hermes. */
export interface PairingRequestToSend {
  method: 'POST';
  path: string;
  body?: Record<string, unknown>;
}

/** Approves a request by its id (never by a code: Hermes does not list the code, and the owner does not need it). */
export function approveRequest(request: PendingRequest, profile: string): PairingRequestToSend {
  return { method: 'POST', path: '/api/pairing/approve', body: { platform: request.platform, request_id: request.requestId, profile } };
}

/** Removes an approved user from a profile's list (Hermes also takes them out of the platform's allowlist, when they are in it). */
export function revokeUser(user: ApprovedUser, profile: string): PairingRequestToSend {
  return { method: 'POST', path: '/api/pairing/revoke', body: { platform: user.platform, user_id: user.userId, profile } };
}

/** Drops every pending request of a profile; nobody who is approved is touched. */
export function clearPending(profile: string): PairingRequestToSend {
  return { method: 'POST', path: `/api/pairing/clear-pending?profile=${encodeURIComponent(profile)}` };
}

/** How long ago, in the words a person would use (rounded down). */
export function ageWords(minutes: number): string {
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
}

/** A platform's id as a name to read: `whatsapp_cloud` is "Whatsapp cloud". */
export function platformName(id: string): string {
  const words = id.replaceAll('_', ' ').trim();
  return words === '' ? 'Unknown' : words[0].toUpperCase() + words.slice(1);
}
