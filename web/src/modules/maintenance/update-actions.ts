// Starting an update (M5 #12): Tier 2, so the owner confirms with a passkey. Caduceus drains, runs the update with a live log, restarts and checks the
// result; the answer names the log to follow.
import type { UpdateTarget } from '@caduceus/contracts/caduceus-api';
import { fetchTiered } from '../../tiered.ts';
import { runTiered, type ActionOutcome } from '../profiles/profile-actions.ts';

export interface Started {
  id: string;
}

const CONFIRM: Record<UpdateTarget, { title: string; text: string; confirmLabel: string; note: string }> = {
  hermes: {
    title: 'Update Hermes?',
    text: 'Caduceus pauses new turns and waits a little for the ones in progress to finish. Hermes then updates itself and Caduceus restarts the Hermes it runs, so every open chat reconnects. Turns start again once the update is checked.',
    confirmLabel: 'Update Hermes',
    note: 'Hermes does not keep the version it replaces. A turn that is still running when Hermes restarts is interrupted.',
  },
  caduceus: {
    title: 'Update Caduceus?',
    text: 'Caduceus pauses new turns and waits a little for the ones in progress to finish. It then pulls its newest version, builds it and restarts itself, and Hermes with it, so every open page reconnects once it is back.',
    confirmLabel: 'Update Caduceus',
    note: 'Caduceus does not keep the version it replaces. A turn that is still running when it restarts is interrupted.',
  },
};

export function startUpdate(target: UpdateTarget): Promise<ActionOutcome<Started>> {
  const text = CONFIRM[target];
  return runTiered<Started>(
    fetchTiered({
      method: 'POST',
      path: '/_caduceus/api/updates/operations',
      body: { target },
      confirm: { title: text.title, text: text.text, object: target === 'hermes' ? 'Hermes' : 'Caduceus', confirmLabel: text.confirmLabel, recoverability: { undoable: false, note: text.note } },
    }),
  );
}
