// The changes Agents › Tools & MCP › Terminal makes in Hermes, each through `fetchTiered` (the backend and the working directory are T3
// writes, blocked in read-only mode and offline). The caller shows toasts and reloads; this says what happened.
import { fetchTiered } from '../../tiered.ts';
import { runTiered, type ActionOutcome } from '../profiles/profile-actions.ts';
import { backendSelect, readBackendAnswer, terminalCwdUpdate, type TerminalBackend } from './terminal-model.ts';

/** Makes `backend` the profile's terminal backend (T3: the backend's name is typed). Hermes saves it and may say the change needs a restart. */
export async function chooseBackend(backend: TerminalBackend, profile: string): Promise<ActionOutcome<{ restartNote: string | undefined }>> {
  const outcome = await runTiered(
    fetchTiered({
      ...backendSelect(backend.name, profile),
      confirm: {
        title: `Run the commands of ${profile} on ${backend.label}?`,
        text: backend.remote
          ? `Hermes saves ${backend.name} as the terminal backend of this profile. The agent’s commands and files then live on another machine, so the paths it works in are paths there, and its commands run with whatever access that machine gives them.`
          : 'Hermes saves local as the terminal backend of this profile: the agent’s commands run on the Mac that runs Hermes, with the access of your account.',
        object: backend.name,
        profile,
        confirmLabel: 'Switch backend',
        recoverability: { undoable: true, note: 'Choose the earlier backend again to go back.' },
      },
    }),
  );
  return outcome.kind === 'done' ? { kind: 'done', body: { restartNote: readBackendAnswer(outcome.body).restartNote } } : outcome;
}

/** Saves the working directory of the profile's terminal (T3: the profile's name is typed). */
export function saveWorkingDirectory(cwd: string, profile: string, remote: boolean): Promise<ActionOutcome> {
  return runTiered(
    fetchTiered({
      ...terminalCwdUpdate(cwd, profile),
      confirm: {
        title: `Start the commands of ${profile} in ${cwd.trim()}?`,
        text: remote ? 'Hermes writes terminal.cwd to the profile’s config. The terminal backend is remote, so this is a path on that machine: Hermes cannot check it from here.' : 'Hermes writes terminal.cwd to the profile’s config. New sessions of this profile start in this folder.',
        object: profile,
        profile,
        confirmLabel: 'Save folder',
      },
    }),
  );
}
