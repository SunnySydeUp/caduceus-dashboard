// What System › Maintenance › Updates shows, as pure functions (M5 #12): an update check turned into the words and choices of its card, the steps of an
// update in the order the Caduceus server does them, the live log folded from its events, and What's New's titles. Hermes holds its own version and
// receipt and Caduceus its deployment; nothing here is kept.
import type { UpdateCheck, UpdateCommit, UpdatePhase, UpdateTarget, WhatsNewEntry } from '@caduceus/contracts/caduceus-api';
import { isRecord } from '@caduceus/contracts/policy/guards';

export type CheckStatus = 'current' | 'available' | 'unknown';

export interface CheckView {
  status: CheckStatus;
  headline: string;
  /** What to tell the owner besides the headline: Hermes's own message, or why this cannot be applied from here. */
  detail: string;
  /** Whether Update may be offered. */
  canUpdate: boolean;
  /** What is new, when the source listed it. */
  changes: UpdateCommit[];
  /** The command the owner can run themselves when an update cannot be applied here. */
  command?: string;
}

/** The card of one install: `label` is `Hermes` or `Caduceus`. Caduceus can only update itself when it can restart itself (`restartable`). */
export function checkView(label: 'Hermes' | 'Caduceus', check: UpdateCheck, { restartable }: { restartable: boolean }): CheckView {
  if (check.update_available) {
    const count = check.behind !== null && check.behind > 0 ? `: ${check.behind} ${check.behind === 1 ? 'change' : 'changes'}` : '';
    const stuck = label === 'Caduceus' && check.can_apply && !restartable;
    return {
      status: 'available',
      headline: `A ${label} update is available${count}`,
      detail: stuck
        ? 'Caduceus is not running as the background service here, so it cannot restart itself after an update. Update it from the command line and start it again.'
        : check.can_apply
          ? (check.message ?? '')
          : (check.message ?? 'This install cannot be updated from here.'),
      canUpdate: check.can_apply && !stuck,
      changes: check.commits ?? [],
      ...(!check.can_apply && check.update_command ? { command: check.update_command } : {}),
    };
  }
  // `behind` is null when the check could not run: that is not the same as being up to date.
  if (check.behind === null) return { status: 'unknown', headline: `${label} could not check for an update`, detail: check.message ?? '', canUpdate: false, changes: [] };
  return { status: 'current', headline: `${label} ${check.current_version} is up to date`, detail: check.message ?? '', canUpdate: false, changes: [] };
}

export type StepState = 'done' | 'current' | 'failed' | 'todo';

export interface Step {
  phase: UpdatePhase;
  label: string;
  state: StepState;
}

/** The steps of each update, in order. Caduceus's own ends with its restart: the process is gone after that, so it has no check and no resume to show. */
const STEPS: Record<UpdateTarget, readonly { phase: UpdatePhase; label: string }[]> = {
  hermes: [
    { phase: 'draining', label: 'Pause new turns' },
    { phase: 'updating', label: 'Update Hermes' },
    { phase: 'restarting', label: 'Restart Hermes' },
    { phase: 'verifying', label: 'Check the result' },
    { phase: 'resuming', label: 'Allow new turns' },
  ],
  caduceus: [
    { phase: 'draining', label: 'Pause new turns' },
    { phase: 'updating', label: 'Update Caduceus' },
    { phase: 'restarting', label: 'Restart Caduceus' },
  ],
};

/** Where an update is: what is done, what is going on (or where it stopped, when it failed) and what is still to come. */
export function phaseSteps(target: UpdateTarget, phase: UpdatePhase, status: OperationStatus = 'running'): Step[] {
  const steps = STEPS[target];
  const at = Math.max(0, steps.findIndex((step) => step.phase === phase));
  return steps.map((step, index) => ({
    ...step,
    state: status === 'ok' || index < at ? 'done' : index > at ? 'todo' : status === 'failed' ? 'failed' : 'current',
  }));
}

export type OperationStatus = 'running' | 'ok' | 'failed' | 'lost';

export interface UpdateState {
  status: OperationStatus;
  phase: UpdatePhase;
  lines: string[];
  /** The server's sentence about how it ended; empty while it runs. */
  message: string;
}

export const startUpdate = (): UpdateState => ({ status: 'running', phase: 'draining', lines: [], message: '' });

const PHASES: readonly string[] = ['draining', 'updating', 'restarting', 'verifying', 'resuming'];

/**
 * Folds one server-sent event of the update log into the state: `phase` and `line` as they come, `end` with how it ended, and `dropped` (the
 * page's own word for a stream that closed) before an end says the page lost the log. Anything else leaves the state as it was.
 */
export function foldUpdate(state: UpdateState, { event, data }: { event: string; data: unknown }): UpdateState {
  if (state.status !== 'running') return state;
  if (event === 'phase' && isRecord(data) && typeof data.phase === 'string' && PHASES.includes(data.phase)) return { ...state, phase: data.phase as UpdatePhase };
  if (event === 'line' && isRecord(data) && typeof data.text === 'string') return { ...state, lines: [...state.lines, data.text] };
  if (event === 'end' && isRecord(data) && typeof data.ok === 'boolean' && typeof data.message === 'string') return { ...state, status: data.ok ? 'ok' : 'failed', message: data.message };
  if (event === 'dropped') return { ...state, status: 'lost', message: 'Caduceus lost the connection to the log. The update may still be running: look at Updates in a moment.' };
  return state;
}

/** The name of an update in What's New: what was updated and the versions it went between. */
export function whatsNewTitle(entry: WhatsNewEntry): string {
  const name = entry.target === 'hermes' ? 'Hermes' : 'Caduceus';
  if (entry.fromVersion && entry.toVersion) return `${name} ${entry.fromVersion} → ${entry.toVersion}`;
  if (entry.fromVersion) return `${name} from ${entry.fromVersion}`;
  if (entry.toVersion) return `${name} to ${entry.toVersion}`;
  return name;
}
