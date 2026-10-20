// What the owner can do to a messaging gateway: start (T1), stop, restart, drain (T2) and the migration (T2). Hermes does the work;
// each goes through `fetchTiered`, which shows the shared dialog with the profile chip for the route's tier. The page that asks
// and the restart-to-apply banner both use these, so a restart is the same action wherever it starts.
import { runTiered, type ActionOutcome } from './modules/profiles/profile-actions.ts';
import { fetchTiered } from './tiered.ts';

export type GatewayVerb = 'start' | 'stop' | 'restart' | 'drain' | 'cancel-drain';

interface Impact {
  /** The other profiles a multiplexed gateway serves: it takes them with it. */
  alsoServes?: readonly string[];
  activeAgents?: number;
}

const joined = (names: readonly string[]) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

/** What a stop or restart interrupts, in a sentence. */
function interrupts({ alsoServes = [], activeAgents = 0 }: Impact): string {
  const shared = alsoServes.length > 0 ? ` It also serves ${joined(alsoServes)}, which go down with it.` : '';
  const busy = activeAgents > 0 ? ` ${activeAgents === 1 ? '1 agent is' : `${activeAgents} agents are`} working now, and ${activeAgents === 1 ? 'its' : 'their'} turn ends.` : '';
  return `${shared}${busy}`;
}

/** Runs one gateway action for `profile` through the policy, asking first for what the tier needs. */
export function runGatewayAction(verb: GatewayVerb, profile: string, impact: Impact = {}): Promise<ActionOutcome> {
  const query = `?profile=${encodeURIComponent(profile)}`;
  switch (verb) {
    case 'start':
      return runTiered(
        fetchTiered({
          method: 'POST',
          path: `/api/gateway/start${query}`,
          confirm: {
            title: `Start the gateway of ${profile}?`,
            text: 'Hermes starts the messaging gateway. Chat platforms connect, and scheduled jobs and Kanban dispatch run again.',
            object: profile,
            profile,
            confirmLabel: 'Start gateway',
          },
        }),
      );
    case 'stop':
      return runTiered(
        fetchTiered({
          method: 'POST',
          path: `/api/gateway/stop${query}`,
          confirm: {
            title: `Stop the gateway of ${profile}?`,
            text: `Chat platforms disconnect, and scheduled jobs and Kanban tasks stop running until it is started again.${interrupts(impact)}`,
            object: profile,
            profile,
            confirmLabel: 'Stop gateway',
          },
        }),
      );
    case 'restart':
      return runTiered(
        fetchTiered({
          method: 'POST',
          path: `/api/gateway/restart${query}`,
          confirm: {
            title: `Restart the gateway of ${profile}?`,
            text: `Chat platforms reconnect on their own after a few seconds, and Hermes finishes work in progress first.${interrupts(impact)}`,
            object: profile,
            profile,
            confirmLabel: 'Restart gateway',
          },
        }),
      );
    case 'drain':
      return runTiered(
        fetchTiered({
          method: 'POST',
          path: '/api/gateway/drain',
          body: { action: 'drain' },
          confirm: {
            title: `Drain the gateway of ${profile}?`,
            text: 'The gateway stops taking new turns from chat platforms and lets work in progress finish. It stays up, and Cancel drain lets it take turns again.',
            object: profile,
            profile,
            confirmLabel: 'Drain gateway',
          },
        }),
      );
    case 'cancel-drain':
      return runTiered(
        fetchTiered({
          method: 'POST',
          path: '/api/gateway/drain',
          body: { action: 'cancel' },
          confirm: {
            title: `Cancel the drain of ${profile}?`,
            text: 'The gateway takes new turns from chat platforms again.',
            object: profile,
            profile,
            confirmLabel: 'Cancel drain',
          },
        }),
      );
  }
}

/** Runs the migration to one multiplexed gateway, which Hermes spawns as `hermes gateway migrate --multiplex --yes`. */
export function runGatewayMigration(): Promise<ActionOutcome> {
  return runTiered(
    fetchTiered({
      method: 'POST',
      path: '/api/gateway/migrate',
      confirm: {
        title: 'Move to one gateway for every profile?',
        text: 'Hermes stops each profile’s own gateway and starts one that serves them all. Chat platforms disconnect while it does, and come back on their own.',
        object: 'every profile',
        confirmLabel: 'Migrate gateways',
      },
    }),
  );
}
