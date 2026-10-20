// The Inbox's system source (M2 #02): what Health says is wrong (a gateway that is down, resource pressure, a missing provider key, a scheduler that
// is not ticking) and a Hermes update that is waiting. These are Health's own Repairs, read again when Hermes says its platforms or jobs moved and
// now and then, never a second opinion: when a Repair goes, its item goes.
import type { HealthReport, Repair } from '@caduceus/contracts/caduceus-api';
import type { InboxAction } from '@caduceus/contracts/inbox';
import { isRecord } from '@caduceus/contracts/policy/guards';
import type { GatewayObserver } from './gateway-observer.ts';
import type { HermesBackend } from './hermes-backend.ts';
import { createPolledSource, type InboxSource, type NoticeDraft } from './inbox-source.ts';

/** Where in Caduceus each kind of Repair is dealt with, when Health's own link is not enough. */
const HEALTH_LINK = { label: 'Open Health', to: '/observe/health' } as const;

/** The gateway is restarted from here when it is stuck: a T2 on the root profile's gateway (the one Health's status describes). */
const RESTART_GATEWAY: InboxAction = {
  id: 'restart-gateway',
  label: 'Restart gateway',
  request: { method: 'POST', path: '/api/gateway/restart?profile=default' },
  confirm: { title: 'Restart the messaging gateway?', text: 'Messaging, scheduled jobs and Kanban dispatch of this profile stop for a moment while the gateway starts again.', object: 'default', confirmLabel: 'Restart gateway' },
  primary: true,
};

/** Health's Repairs as notices. A Repair that is only for information is FYI, the rest are failures. Pure. */
export function repairNotices(repairs: readonly Repair[]): NoticeDraft[] {
  return repairs.map((repair) => ({
    id: `health:${repair.id}`,
    ref: `health:${repair.id}`,
    stamp: '',
    group: repair.severity === 'info' ? 'fyi' : 'failed',
    category: 'system',
    profile: undefined,
    title: repair.title,
    detail: repair.cause,
    actions: repair.id === 'gateway-unresponsive' ? [RESTART_GATEWAY] : [],
    link: repair.link ?? HEALTH_LINK,
  }));
}

/** The notice for a Hermes update, from `GET /api/hermes/update/check`; none when Hermes is up to date or could not say. Pure. */
export function updateNotice(check: unknown): NoticeDraft[] {
  if (!isRecord(check) || check.update_available !== true) return [];
  const behind = typeof check.behind === 'number' && check.behind > 0 ? `${check.behind} ${check.behind === 1 ? 'commit' : 'commits'} behind` : 'behind';
  const version = typeof check.current_version === 'string' ? check.current_version : undefined;
  return [
    {
      id: 'update:hermes',
      ref: 'update:hermes',
      stamp: String(check.behind ?? ''),
      group: 'fyi',
      category: 'system',
      profile: undefined,
      title: 'A Hermes update is available',
      detail: `${version ? `This is Hermes ${version}, ` : 'This Hermes is '}${behind}. Updating is done on the Mac that runs Hermes, with “hermes update”.`,
      actions: [],
      link: HEALTH_LINK,
    },
  ];
}

export interface SystemSourceDeps {
  backend: HermesBackend;
  observer: GatewayObserver;
  now: () => number;
  pollMs: number;
  /** Health's report, asked again. */
  report(): Promise<HealthReport>;
  /** How long an update check is trusted: Hermes asks GitHub, which is not for every tick. */
  updateEveryMs: number;
  /** Whether to ask at all. */
  checkUpdates: boolean;
}

export function createSystemSource({ backend, observer, now, pollMs, report, updateEveryMs, checkUpdates }: SystemSourceDeps): InboxSource {
  let checked: { at: number; notices: NoticeDraft[] } | undefined;
  const update = async (): Promise<NoticeDraft[]> => {
    if (!checkUpdates) return [];
    if (checked && now() - checked.at < updateEveryMs) return checked.notices;
    const res = await backend.fetch('/api/hermes/update/check', { signal: AbortSignal.timeout(20_000) }).catch(() => undefined);
    // A check that did not answer is tried again at the next read, and says nothing in the meantime.
    const notices = res?.ok ? updateNotice(await res.json().catch(() => undefined)) : [];
    if (res?.ok) checked = { at: now(), notices };
    return notices;
  };
  return createPolledSource({
    now,
    pollMs,
    async read() {
      const health = await report();
      return [...repairNotices(health.repairs), ...(await update())];
    },
    wake: (refresh) => observer.onEvent((type) => (type === 'platforms.changed' || type === 'cron.changed') && refresh()),
  });
}
