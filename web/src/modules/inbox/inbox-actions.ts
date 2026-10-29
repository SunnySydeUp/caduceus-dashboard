// The owner's decision on an Inbox item (M2 #01), sent to Caduceus, which gives it to Hermes. It goes through `fetchTiered` with the tier
// the policy map gives the route: Allow always is a standing permission (T2: a passkey), the rest need no dialog. The caller shows toasts.
import type { InboxAction, InboxDecision, InboxDecisionResult, InboxItem } from '@caduceus/contracts/inbox';
import { fetchTiered } from '../../tiered.ts';
import { runTiered } from '../profiles/profile-actions.ts';
import { confirmWithWords } from './inbox-model.ts';

export type DecisionOutcome =
  | { kind: 'resolved' }
  /** Hermes was no longer waiting: answered elsewhere, withdrawn or expired. Not an error. */
  | { kind: 'already-answered' }
  | { kind: 'cancelled' }
  | { kind: 'failed'; message: string };

export async function decideItem(item: InboxItem, decision: InboxDecision): Promise<DecisionOutcome> {
  const outcome = await runTiered<InboxDecisionResult>(
    fetchTiered({
      method: 'POST',
      path: `/_caduceus/api/inbox/${encodeURIComponent(item.id)}/decision`,
      body: decision,
      confirm: {
        title: 'Allow this always?',
        text: 'Hermes will stop asking for this kind of command in every session, for as long as you keep the permission. It is kept in the profile’s settings.',
        profile: item.profile,
        confirmLabel: 'Allow always',
      },
    }),
  );
  if (outcome.kind === 'cancelled') return outcome;
  if (outcome.kind === 'failed') return outcome;
  return outcome.body.status === 'resolved' ? { kind: 'resolved' } : { kind: 'already-answered' };
}

/** What an action on a notice came to: it was sent (Hermes's answer is in the list that follows), the owner declined, or it failed, in words. */
export type NoticeOutcome = { kind: 'done' } | { kind: 'cancelled' } | { kind: 'failed'; message: string };

/** Runs the action a source put on its item, through the policy with the tier the route has; its confirmation names what it changes and says back the words the owner wrote. */
export async function runNoticeAction(action: InboxAction, typed?: string): Promise<NoticeOutcome> {
  const body = action.input ? { ...action.request.body, [action.input.field]: typed ?? '' } : action.request.body;
  const outcome = await runTiered(
    fetchTiered({ method: action.request.method, path: action.request.path, body, confirm: confirmWithWords(action, typed) }),
  );
  return outcome.kind === 'done' ? { kind: 'done' } : outcome;
}

/** Puts an item aside on this device (a snooze until `until`, else a dismissal until its Hermes state changes). Kept by Caduceus per device; Hermes is untouched. */
export async function hideItem(item: InboxItem, until?: number): Promise<void> {
  const res = await fetch('/_caduceus/api/inbox/hide', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ref: item.ref, stamp: item.stamp, ...(until === undefined ? {} : { until }) }) });
  if (!res.ok) throw new Error(`Caduceus answered HTTP ${res.status}`);
}

/** Brings a snoozed item back on this device. */
export async function unhideItem(ref: string): Promise<void> {
  const res = await fetch(`/_caduceus/api/inbox/hide?ref=${encodeURIComponent(ref)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Caduceus answered HTTP ${res.status}`);
}

/** Says this device has seen the activity feed up to `seq`. */
export async function markActivitySeen(seq: number): Promise<void> {
  await fetch('/_caduceus/api/inbox/activity/seen', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ seq }) });
}
