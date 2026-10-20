// QR onboarding of Telegram and WhatsApp (M5 #03), as pure functions: the requests Caduceus sends Hermes's onboarding endpoints, and what Hermes's answers mean. Hermes drives the
// pairing (Telegram through Nous's setup service, WhatsApp through its bridge); Caduceus starts it, polls, and, once Hermes says it is linked, saves who may talk to the agent.
import { isRecord } from '@caduceus/contracts/policy/guards';

export type QrPlatform = 'telegram' | 'whatsapp';

/** Where a pairing is, as the sheet shows it. */
export type OnboardingState =
  /** WhatsApp's bridge is installing or starting: there is no QR yet. */
  | { phase: 'preparing'; pairingId: string }
  /** The QR is showing and Hermes is waiting for the scan. `link` is something to open or copy instead (Telegram's link; WhatsApp's pairing code text). */
  | { phase: 'qr'; pairingId: string; qr: string; link: string; expiresAt: string | null; suggestedName?: string }
  /** Hermes reports the bot made or the device linked. `account` names it; `suggestedUsers` is what to offer for the allowed users. */
  | { phase: 'linked'; pairingId: string; account: string; suggestedUsers: string }
  | { phase: 'expired'; message: string }
  | { phase: 'failed'; message: string };

const BASE = (platform: QrPlatform) => `/api/messaging/${platform}/onboarding`;

/** The requests, each as `fetchTiered` and the tests send it. Starting is T1, saving the allowed users T2, polling and cancelling make no change to a platform. */
export const onboardingRequests = {
  start: (platform: QrPlatform, profile: string) =>
    platform === 'telegram'
      ? { method: 'POST', path: `${BASE(platform)}/start`, body: {} as Record<string, unknown> }
      : { method: 'POST', path: `${BASE(platform)}/start`, body: { mode: 'bot', allowed_users: '', profile } as Record<string, unknown> },
  status: (platform: QrPlatform, pairingId: string) => ({ method: 'GET', path: `${BASE(platform)}/${encodeURIComponent(pairingId)}` }),
  cancel: (platform: QrPlatform, pairingId: string) => ({ method: 'DELETE', path: `${BASE(platform)}/${encodeURIComponent(pairingId)}` }),
  apply: (platform: QrPlatform, pairingId: string, profile: string, users: string[]) => ({
    method: 'POST',
    path: `${BASE(platform)}/${encodeURIComponent(pairingId)}/apply`,
    body: (platform === 'telegram' ? { allowed_user_ids: users, profile } : { allowed_users: users.join(','), profile }) as Record<string, unknown>,
  }),
};

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** Hermes's answer to starting (or, for WhatsApp, polling): the state it means, `undefined` when it is not an answer of that shape. */
export function readOnboarding(platform: QrPlatform, body: unknown): OnboardingState | undefined {
  if (!isRecord(body)) return undefined;
  if (platform === 'telegram') {
    const pairingId = text(body.pairing_id);
    const link = text(body.deep_link);
    if (pairingId && link) {
      return { phase: 'qr', pairingId, qr: text(body.qr_payload) || link, link, expiresAt: text(body.expires_at) || null, suggestedName: text(body.suggested_username) || undefined };
    }
    return undefined;
  }
  const pairingId = text(body.pairing_id);
  const status = text(body.status);
  if (!pairingId) return undefined;
  if (status === 'connected') {
    const account = text(body.account_name) || text(body.account_phone) || text(body.account_id) || 'WhatsApp';
    return { phase: 'linked', pairingId, account, suggestedUsers: text(body.allowed_users) || text(body.account_phone) };
  }
  if (status === 'waiting' && text(body.qr_payload)) return { phase: 'qr', pairingId, qr: text(body.qr_payload), link: text(body.qr_payload), expiresAt: text(body.expires_at) || null };
  if (status === 'installing' || status === 'starting' || status === 'waiting') return { phase: 'preparing', pairingId };
  if (status === 'expired') return { phase: 'expired', message: 'The WhatsApp setup expired. Start it again.' };
  if (status === 'cancelled') return { phase: 'failed', message: text(body.error) || 'The WhatsApp setup was cancelled.' };
  return { phase: 'failed', message: text(body.error) || 'WhatsApp pairing failed.' };
}

/**
 * What a poll of a Telegram pairing came to. `waiting` leaves the QR as it is; `ready` is the bot made (its name, and the Telegram user id of the person who scanned,
 * which is the one id worth offering as allowed). A 410 is Hermes saying the pairing expired or was claimed.
 */
export function readTelegramPoll(status: number, body: unknown, pairingId: string, qr: Extract<OnboardingState, { phase: 'qr' }>): OnboardingState {
  const detail = isRecord(body) ? text(body.detail) : '';
  if (status === 410) return { phase: 'expired', message: detail || 'The Telegram setup expired. Start it again.' };
  if (status === 404) return { phase: 'expired', message: detail || 'Hermes no longer has this setup. Start it again.' };
  if (status < 200 || status >= 300 || !isRecord(body)) return { phase: 'failed', message: detail || `Hermes answered HTTP ${status}.` };
  if (body.status === 'ready') {
    const username = text(body.bot_username);
    return { phase: 'linked', pairingId, account: username ? `@${username}` : 'your new Telegram bot', suggestedUsers: text(body.owner_user_id) };
  }
  return body.status === 'waiting' ? { ...qr, expiresAt: text(body.expires_at) || qr.expiresAt } : { phase: 'failed', message: 'Hermes did not say whether the bot is ready.' };
}

/** What a poll of a WhatsApp pairing came to (Hermes answers a 410 once it has expired). */
export function readWhatsAppPoll(status: number, body: unknown): OnboardingState {
  const detail = isRecord(body) ? text(body.detail) : '';
  if (status === 410) return { phase: 'expired', message: detail || 'The WhatsApp setup expired. Start it again.' };
  if (status === 404) return { phase: 'expired', message: detail || 'Hermes no longer has this setup. Start it again.' };
  return readOnboarding('whatsapp', body) ?? { phase: 'failed', message: detail || `Hermes answered HTTP ${status}.` };
}

export type AllowedUsers = { ok: true; users: string[] } | { ok: false; message: string };

/**
 * The people the owner allows to talk to the agent. Telegram wants numeric user ids and at least one (Hermes refuses none). WhatsApp wants phone numbers (digits, with an optional
 * leading +), and a blank list keeps whatever Hermes already allows.
 */
export function parseAllowedUsers(platform: QrPlatform, input: string): AllowedUsers {
  const users = [...new Set(input.split(/[\s,]+/).filter((part) => part !== ''))];
  if (platform === 'telegram') {
    if (users.length === 0) return { ok: false, message: 'Add at least one Telegram user id: the agent would answer nobody.' };
    const bad = users.find((user) => !/^\d+$/.test(user));
    return bad ? { ok: false, message: `“${bad}” is not a Telegram user id. They are numbers, such as 123456789.` } : { ok: true, users };
  }
  const bad = users.find((user) => !/^\+?\d{5,}$/.test(user));
  return bad ? { ok: false, message: `“${bad}” is not a phone number. Use digits with the country code, such as 61400111222.` } : { ok: true, users };
}

/** Seconds left until `expiresAt` (ISO), never below zero; `undefined` when there is none or it is not a time. */
export function secondsLeft(expiresAt: string | null, now: number): number | undefined {
  if (!expiresAt) return undefined;
  const at = Date.parse(expiresAt);
  return Number.isNaN(at) ? undefined : Math.max(0, Math.round((at - now) / 1000));
}

/** "4:05" for 245 seconds. */
export const clock = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
