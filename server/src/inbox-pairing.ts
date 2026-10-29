// The Inbox's pairing source (M2 #02): the strangers who wrote to a profile's bot and wait to be approved. They come from Hermes's pairing list of each
// profile (`GET /api/pairing?profile=`), read again when Hermes says pairing moved (`pairing.changed`). A request approved or cleared anywhere else is no
// longer in the list, so its item goes by itself.
import { isRecord } from '@caduceus/contracts/policy/guards';
import type { InboxAction } from '@caduceus/contracts/inbox';
import type { GatewayObserver } from './gateway-observer.ts';
import type { HermesBackend } from './hermes-backend.ts';
import { createPolledSource, type InboxSource, type NoticeDraft } from './inbox-source.ts';

const text = (value: unknown): string => (typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '');

/** A platform's id as a name to read: `whatsapp_cloud` is "Whatsapp cloud". */
const platformName = (id: string): string => {
  const words = id.replaceAll('_', ' ').trim();
  return words === '' ? 'a platform' : words[0]!.toUpperCase() + words.slice(1);
};

/** The pending requests of one profile's pairing answer, as notices. Pure. */
export function pairingNotices(body: unknown, profile: string): NoticeDraft[] {
  const pending = isRecord(body) && Array.isArray(body.pending) ? body.pending : [];
  // The people really waiting: an entry with no platform or user is not shown, so it does not count when telling whether one person is alone in the list.
  const waiting = pending.filter((entry) => isRecord(entry) && text(entry.platform) !== '' && text(entry.user_id) !== '').length;
  return pending.flatMap((entry): NoticeDraft[] => {
    if (!isRecord(entry)) return [];
    const platform = text(entry.platform);
    const requestId = text(entry.request_id);
    const userId = text(entry.user_id);
    if (platform === '' || userId === '') return [];
    const who = text(entry.user_name) ? `${text(entry.user_name)} (${userId})` : userId;
    return [
      {
        id: `pairing:${profile}:${platform}:${requestId || userId}`,
        ref: `pairing:${profile}:${platform}:${userId}`,
        stamp: requestId,
        group: 'decision',
        category: 'pairing',
        profile,
        title: `${who} wants to talk to your ${platformName(platform)} bot`,
        detail: `This person messaged the ${platformName(platform)} bot of ${profile}. Approve them, and the bot answers them with everything this profile can do.`,
        // An older Hermes wrote a request with no id, which can only be approved with its code: the Pairing screen says so.
        actions:
          requestId === ''
            ? []
            : [
                {
                  id: 'approve',
                  label: 'Approve',
                  request: { method: 'POST', path: '/api/pairing/approve', body: { platform, request_id: requestId, profile } },
                  confirm: { title: `Approve ${who} on ${platformName(platform)} for ${profile}?`, text: `The ${platformName(platform)} bot of ${profile} starts answering this person, with everything this profile’s agent can do.`, confirmLabel: 'Approve person' },
                  primary: true,
                },
                // Hermes can refuse no single request: it can only clear the profile's whole waiting list. That is the same thing for the only person waiting, and for
                // nobody else, so one card never clears another's request: with two waiting, Pairing has the list.
                ...(waiting === 1
                  ? [
                      {
                        id: 'decline',
                        label: 'Decline',
                        request: { method: 'POST', path: `/api/pairing/clear-pending?profile=${encodeURIComponent(profile)}` },
                        confirm: {
                          title: `Decline ${who}?`,
                          text: `The ${platformName(platform)} bot of ${profile} will not answer ${text(entry.user_name) || 'this person'}. Their request is cleared, and they can ask again. Hermes clears the whole waiting list of ${profile}, so anyone who asked in the last moments is cleared too.`,
                          confirmLabel: 'Decline',
                        },
                      } satisfies InboxAction,
                    ]
                  : []),
              ],
        link: { label: 'Open Pairing', to: `/connect/pairing?profile=${encodeURIComponent(profile)}` },
      },
    ];
  });
}

export interface PairingSourceDeps {
  backend: HermesBackend;
  observer: GatewayObserver;
  now: () => number;
  pollMs: number;
}

export function createPairingSource({ backend, observer, now, pollMs }: PairingSourceDeps): InboxSource {
  return createPolledSource({
    now,
    pollMs,
    async read() {
      const listed = await backend.fetch('/api/profiles');
      const body: unknown = await listed.json().catch(() => undefined);
      const names = isRecord(body) && Array.isArray(body.profiles) ? body.profiles.flatMap((profile) => (isRecord(profile) && typeof profile.name === 'string' ? [profile.name] : [])) : [];
      if (!listed.ok || names.length === 0) throw new Error('Hermes did not list its profiles');
      const found: NoticeDraft[] = [];
      for (const name of names) {
        const res = await backend.fetch(`/api/pairing?profile=${encodeURIComponent(name)}`);
        // A profile whose list cannot be read is left out of this read, but a read that failed for every profile fails as a whole (the items stay).
        if (res.ok) found.push(...pairingNotices(await res.json().catch(() => undefined), name));
        else if (names.length === 1) throw new Error(`Hermes answered HTTP ${res.status}`);
      }
      return found;
    },
    wake: (refresh) => observer.onEvent((type) => type === 'pairing.changed' && refresh()),
  });
}
