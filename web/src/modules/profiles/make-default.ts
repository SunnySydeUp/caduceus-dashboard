// Make default: the one action in the web app that writes Hermes's sticky active profile (`hermes profile use`), and a Tier 2.
// It changes what the CLI, new gateway sessions and any tab without a `?profile=` use. `profiles-active-write.test.ts` holds
// the rest of the app to never writing it.
import { fetchTiered } from '../../tiered.ts';
import { runTiered, type ActionOutcome } from './profile-actions.ts';

export function makeDefault(name: string, previous: string): Promise<ActionOutcome> {
  return runTiered(
    fetchTiered({
      method: 'POST',
      path: '/api/profiles/active',
      body: { name },
      confirm: {
        title: `Make ${name} the default profile?`,
        text: `Hermes’s default profile moves from ${previous} to ${name}. The command line, new gateway sessions and tabs with no profile of their own will use ${name}. Tabs that chose a profile are not affected.`,
        object: name,
        profile: name,
        confirmLabel: 'Make default',
      },
    }),
  );
}
