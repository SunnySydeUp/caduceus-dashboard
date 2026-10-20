// The changes Agents › Tools & MCP makes in Hermes, each through `fetchTiered` with the tier the policy map gives the route (a toolset
// switch, provider or model T1, its keys T2, its setup and a config write T3, which is blocked in read-only mode). The caller shows
// toasts and reloads; this says what happened. Caduceus keeps nothing of what it sends, and a key is never put in a message or a
// toast: names only.
import { fetchTiered } from '../../tiered.ts';
import { runTiered, type ActionOutcome } from '../profiles/profile-actions.ts';
import type { LogRun } from '../skills/ActionLogSheet.tsx';
import { computerUseGrant, readProviderAnswer, readToggleAnswer, setupResult, toolsetEnv, toolsetModel, toolsetPostSetup, toolsetProvider, toolsetToggle, type Toolset } from './tools-model.ts';
import type { HermesRequest } from '../channels/channels-model.ts';

/** Switches a toolset on or off (T1). Hermes may start an install the toolset's tool needs; `installStarted` names it. */
export async function setToolsetEnabled(toolset: Toolset, profile: string, enabled: boolean): Promise<ActionOutcome<{ installStarted: string | undefined }>> {
  const request = toolsetToggle(toolset.name, profile, enabled);
  const outcome = await runTiered(
    fetchTiered({
      ...request,
      confirm: {
        title: `${enabled ? 'Switch on' : 'Switch off'} ${toolset.label} for ${profile}?`,
        text: enabled ? `Hermes adds ${toolset.name} to the toolsets of ${toolset.platformLabel} for this profile. New sessions get its tools; a chat that is already open keeps the tools it has.` : `Hermes removes ${toolset.name} from the toolsets of ${toolset.platformLabel} for this profile. New sessions do not get its tools.`,
        object: toolset.label,
        profile,
        confirmLabel: enabled ? 'Switch on' : 'Switch off',
      },
    }),
  );
  return outcome.kind === 'done' ? { kind: 'done', body: readToggleAnswer(outcome.body) } : outcome;
}

/** Makes `provider` the toolset's provider (T1). Hermes says when a Nous Portal provider cannot work until the Portal is signed in. */
export async function chooseProvider(toolset: Toolset, profile: string, provider: string): Promise<ActionOutcome<{ needsNousAuth: boolean; feature?: string }>> {
  const request = toolsetProvider(toolset.name, profile, provider);
  const outcome = await runTiered(
    fetchTiered({
      ...request,
      confirm: {
        title: `Use ${provider} for ${toolset.label} of ${profile}?`,
        text: 'Hermes writes the choice to the profile’s config. The keys of the other providers stay as they are.',
        object: toolset.label,
        profile,
        confirmLabel: 'Use this provider',
      },
    }),
  );
  return outcome.kind === 'done' ? { kind: 'done', body: readProviderAnswer(outcome.body) } : outcome;
}

/** Chooses the toolset's model from its provider's catalogue (T1). */
export function chooseModel(toolset: Toolset, profile: string, model: { id: string; display: string }, provider: string | undefined): Promise<ActionOutcome> {
  const request = toolsetModel(toolset.name, profile, model.id, provider);
  return runTiered(
    fetchTiered({
      ...request,
      confirm: {
        title: `Use ${model.display} for ${toolset.label} of ${profile}?`,
        text: 'Hermes writes the model to the profile’s config. New sessions use it.',
        object: toolset.label,
        profile,
        confirmLabel: 'Use this model',
      },
    }),
  );
}

/** Saves the keys that were typed (T2: a passkey step-up). The values travel to Hermes and nowhere else; the confirmation names the variables, never a value. */
export async function saveToolsetKeys(toolset: Toolset, profile: string, values: Readonly<Record<string, string>>): Promise<ActionOutcome<{ saved: string[] }>> {
  const request = toolsetEnv(toolset.name, profile, values);
  const names = Object.keys((request.body as { env: Record<string, string> }).env);
  const outcome = await runTiered<{ saved?: unknown }>(
    fetchTiered({
      ...request,
      confirm: {
        title: `Save ${names.length === 1 ? 'a key' : `${names.length} keys`} for ${toolset.label} of ${profile}?`,
        text: `Hermes writes ${names.join(', ')} to this profile’s .env file. It never sends a saved key back.`,
        object: toolset.label,
        profile,
        confirmLabel: 'Save keys',
      },
    }),
  );
  if (outcome.kind !== 'done') return outcome;
  const saved = outcome.body.saved;
  return { kind: 'done', body: { saved: Array.isArray(saved) ? saved.filter((name): name is string => typeof name === 'string') : [] } };
}

/** Starts a provider's setup (T3: the toolset's name is typed to confirm). Hermes runs it as a background action whose log the caller follows. */
export function startToolsetSetup(toolset: Toolset, profile: string, provider: string, key: string): Promise<ActionOutcome> {
  const request = toolsetPostSetup(toolset.name, profile, key);
  return runTiered(
    fetchTiered({
      ...request,
      confirm: {
        title: `Run the setup of ${provider} for ${toolset.label}?`,
        text: 'Hermes runs the provider’s own install or sign-in step on this computer, for this profile. It can download software.',
        object: toolset.name,
        profile,
        confirmLabel: 'Run setup',
      },
    }),
  );
}

/** Saves `platform_toolsets` (a config write, T3: the profile’s name is typed to confirm). */
export function savePlatformToolsets(profile: string, request: HermesRequest, platforms: readonly string[]): Promise<ActionOutcome> {
  return runTiered(
    fetchTiered({
      ...request,
      confirm: {
        title: `Save the toolsets of ${platforms.length === 1 ? 'one platform' : `${platforms.length} platforms`} for ${profile}?`,
        text: `Hermes writes the toolsets of ${platforms.join(', ')} to the profile’s config. New sessions use them; a chat that is already open keeps the tools it has.`,
        object: profile,
        profile,
        confirmLabel: 'Save toolsets',
      },
    }),
  );
}

/** Asks Hermes to request Computer Use’s permissions from the system (T3). Hermes runs it as a background action whose log the caller follows. */
export function requestComputerUsePermissions(profile: string): Promise<ActionOutcome> {
  const request = computerUseGrant(profile);
  return runTiered(
    fetchTiered({
      ...request,
      confirm: {
        title: 'Ask macOS for Computer Use’s permissions?',
        text: 'Hermes opens the system’s Accessibility and Screen Recording requests for its Computer Use driver. Approve them in the dialogs that macOS shows on this computer.',
        object: profile,
        profile,
        confirmLabel: 'Ask for permissions',
      },
    }),
  );
}

/** How a log of setup (or of a driver's permission request) ends, as the log sheet shows it. */
export const judgeSetup: LogRun['judge'] = async (log) => {
  const result = setupResult(log);
  return result.ok ? { ok: true, message: 'Setup finished.' } : { ok: false, message: result.message };
};
