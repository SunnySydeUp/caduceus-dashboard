// The changes Connect › Channels makes in Hermes, each through `fetchTiered` with the tier the policy map gives the route (save and
// enable or disable T2, a config write T3; a test only reads, so it is a read). The caller shows toasts and reloads; this says what happened. Caduceus keeps
// nothing of what it sends, and a value is never put in a message or a toast: names only.
import { raiseRestartNeeded } from '../../restart-to-apply.ts';
import { fetchTiered } from '../../tiered.ts';
import { runTiered, type ActionOutcome } from '../profiles/profile-actions.ts';
import { behaviourUpdate, channelTestPath, channelUpdate, readSaveAnswer, readTestAnswer, testResultFor, type BehaviourField, type BehaviourValue, type Channel } from './channels-model.ts';

/** What came of a save: Hermes took it, and whether a gateway restart is now waiting on it. */
export interface Saved {
  needsRestart: boolean;
}

/** Tells the restart-to-apply banner that `profile`'s gateway has to restart for a change, unless Hermes applied it at once. */
async function raiseIfNeeded(saved: Saved, profile: string, reason: string): Promise<void> {
  if (saved.needsRestart) await raiseRestartNeeded(profile, reason);
}

/** Saves what the owner typed, and what they cleared, for a platform (T2). The values travel to Hermes and nowhere else. */
export async function saveChannel(channel: Channel, profile: string, change: { values: Record<string, string>; clear: string[]; enabled?: boolean }): Promise<ActionOutcome<Saved>> {
  const request = channelUpdate(channel.id, profile, change);
  const changed = Object.keys(change.values).filter((key) => change.values[key].trim() !== '').length + change.clear.length;
  const outcome = await runTiered(
    fetchTiered({
      ...request,
      confirm: {
        title: `Save ${channel.name} for ${profile}?`,
        text: `Hermes writes ${changed === 1 ? 'the changed value' : `${changed} changed values`} to this profile’s .env file${change.enabled === undefined ? '' : ` and ${change.enabled ? 'enables' : 'disables'} the platform`}. A gateway restart applies it.`,
        object: channel.name,
        profile,
        confirmLabel: 'Save channel',
      },
    }),
  );
  if (outcome.kind !== 'done') return outcome;
  const saved = readSaveAnswer(outcome.body);
  await raiseIfNeeded(saved, profile, `${channel.name} channel saved`);
  return { kind: 'done', body: saved };
}

/** Switches a platform on or off (T2). */
export async function setChannelEnabled(channel: Channel, profile: string, enabled: boolean): Promise<ActionOutcome<Saved>> {
  const request = channelUpdate(channel.id, profile, { enabled });
  const outcome = await runTiered(
    fetchTiered({
      ...request,
      confirm: {
        title: `${enabled ? 'Enable' : 'Disable'} ${channel.name} for ${profile}?`,
        text: enabled ? 'The gateway connects this platform the next time it starts. Nothing else about it changes.' : 'The gateway drops this platform the next time it starts. Its settings and credentials stay.',
        object: channel.name,
        profile,
        confirmLabel: enabled ? 'Enable' : 'Disable',
      },
    }),
  );
  if (outcome.kind !== 'done') return outcome;
  const saved = readSaveAnswer(outcome.body);
  await raiseIfNeeded(saved, profile, `${channel.name} ${enabled ? 'enabled' : 'disabled'}`);
  return { kind: 'done', body: saved };
}

/**
 * Asks Hermes to test a platform and gives its answer. The test only reads the platform's state (it sends nothing to the chat platform and
 * writes nothing), so the policy map makes it a read: it runs at once, with no confirmation, and also in read-only mode.
 */
export async function testChannel(channel: Channel, profile: string): Promise<ActionOutcome<{ ok: boolean; message: string }>> {
  const outcome = await runTiered(fetchTiered({ method: 'POST', path: channelTestPath(channel.id, profile) }));
  return outcome.kind === 'done' ? { kind: 'done', body: testResultFor(channel, readTestAnswer(outcome.body)) } : outcome;
}

/** Writes the changed behaviour keys to the profile's config (T3: the profile's name is typed to confirm), then raises the restart notice. */
export async function saveBehaviour(channel: Channel, profile: string, fields: readonly BehaviourField[], changes: Record<string, BehaviourValue>): Promise<ActionOutcome<Saved>> {
  const request = behaviourUpdate(profile, changes);
  const labels = fields.filter((field) => field.key in changes).map((field) => field.label.toLowerCase());
  const outcome = await runTiered(
    fetchTiered({
      ...request,
      confirm: {
        title: `Save the ${channel.name} settings of ${profile}?`,
        text: `Hermes writes ${labels.join(', ')} to the profile’s config. A gateway restart applies it.`,
        object: profile,
        profile,
        confirmLabel: 'Save settings',
      },
    }),
  );
  if (outcome.kind !== 'done') return outcome;
  const saved = { needsRestart: true };
  await raiseIfNeeded(saved, profile, `${channel.name} settings saved`);
  return { kind: 'done', body: saved };
}
