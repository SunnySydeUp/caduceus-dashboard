// The changes Agents › Memory makes in Hermes, each through `fetchTiered` with the tier the policy map gives the request: choosing a provider
// T1, saving its form T2, installing what it needs T3, starting its sign-in T1, saving the context engine T2, editing or deleting a node of the
// learning graph T1. The caller shows toasts and reloads; this says what happened. A secret goes to Hermes and nowhere else: no confirmation,
// toast or message here ever has one. Caduceus keeps nothing of what it sends.
import { fetchTiered } from '../../tiered.ts';
import { runTiered, type ActionOutcome } from '../profiles/profile-actions.ts';
import { contextEngineSave, formSave, nodeDelete, nodeSave, oauthStart, parseOauth, providerSelect, readChange, type Edits, type GraphNode, type MemoryProvider, type OauthStatus, type ProviderForm } from './memory-model.ts';

/** Makes a ready provider the profile's, or `undefined` for the built-in memory (T1). */
export function chooseProvider(provider: MemoryProvider | undefined, profile: string): Promise<ActionOutcome> {
  return runTiered(
    fetchTiered({
      ...providerSelect(provider?.name ?? '', profile),
      confirm: {
        title: provider ? `Use ${provider.name} for ${profile}?` : `Go back to the built-in memory for ${profile}?`,
        text: provider
          ? `Hermes makes ${provider.name} the memory provider of ${profile}. New sessions use it besides MEMORY.md and USER.md; a chat that is already open keeps the provider it started with.`
          : `Hermes stops using an outside memory provider for ${profile}. MEMORY.md and USER.md stay as they are, and so does everything the provider stored.`,
        object: provider?.name ?? 'built-in memory',
        profile,
        confirmLabel: provider ? 'Use provider' : 'Use built-in memory',
        recoverability: { undoable: true, note: 'Choose the other provider again to switch back.' },
      },
    }),
  );
}

/** Saves a provider's form (T2: a passkey). Hermes also makes the provider the profile's. */
export function saveProviderForm(form: ProviderForm, edits: Edits, profile: string): Promise<ActionOutcome> {
  return runTiered(
    fetchTiered({
      ...formSave(form, edits, profile),
      confirm: {
        title: `Save the ${form.label || form.name} settings for ${profile}?`,
        text: `Hermes saves these settings for ${profile} and makes ${form.name} its memory provider. A key you typed goes to Hermes and is never shown again; a key you left empty stays as it is.`,
        object: form.name,
        profile,
        confirmLabel: 'Save and use provider',
        recoverability: { undoable: true, note: 'Edit the settings again to change them back.' },
      },
    }),
  );
}

/** Starts a provider's own sign-in (T1). Hermes opens the provider's page in the browser of the computer it runs on. */
export async function startProviderSignIn(provider: string, profile: string): Promise<ActionOutcome<OauthStatus | undefined>> {
  const outcome = await runTiered(
    fetchTiered({
      ...oauthStart(provider, profile),
      confirm: {
        title: `Connect ${provider} for ${profile}?`,
        text: 'Hermes opens the provider’s sign-in page in the browser of the computer it runs on, and waits there for you to sign in and allow access. Caduceus never sees your password.',
        object: provider,
        profile,
        confirmLabel: 'Start sign-in',
      },
    }),
  );
  return outcome.kind === 'done' ? { kind: 'done', body: parseOauth(outcome.body) } : outcome;
}

export interface SetupStep {
  kind: string;
  name: string;
  status: string;
  command: string;
  stdout: string;
  stderr: string;
}

/** What Hermes did when it set a provider up: every step with how it ended. */
export interface SetupResult {
  ok: boolean;
  steps: SetupStep[];
}

const word = (value: unknown) => (typeof value === 'string' ? value : '');

/** Installs what a provider needs (T3: the provider's name typed). Hermes runs the pip installs and the provider's own check and install commands on this computer. */
export async function runProviderSetup(provider: MemoryProvider, profile: string): Promise<ActionOutcome<SetupResult>> {
  const needs = [...(provider.setup?.pipDependencies.map((dependency) => `pip install ${dependency}`) ?? []), ...(provider.setup?.externalDependencies.flatMap((dependency) => (dependency.install ? [dependency.install] : [])) ?? [])];
  const outcome = await runTiered<{ ok?: unknown; results?: unknown }>(
    fetchTiered({
      method: 'POST',
      path: `/api/memory/providers/${encodeURIComponent(provider.name)}/setup?profile=${encodeURIComponent(profile)}`,
      body: {},
      confirm: {
        title: `Set up ${provider.name}?`,
        text: needs.length > 0 ? `Hermes runs these on this computer, with the access of your account: ${needs.join('; ')}.` : `${provider.name} declares nothing to install, so Hermes runs nothing.`,
        object: provider.name,
        profile,
        confirmLabel: 'Run setup',
      },
    }),
  );
  if (outcome.kind !== 'done') return outcome;
  const steps = (Array.isArray(outcome.body.results) ? outcome.body.results : []).flatMap((row): SetupStep[] => {
    const record = typeof row === 'object' && row !== null ? (row as Record<string, unknown>) : {};
    return [{ kind: word(record.kind), name: word(record.name), status: word(record.status), command: word(record.command), stdout: word(record.stdout), stderr: word(record.stderr) }];
  });
  return { kind: 'done', body: { ok: outcome.body.ok === true, steps } };
}

/** Saves the profile's context engine (T2: a passkey). */
export function saveContextEngine(name: string, profile: string): Promise<ActionOutcome> {
  return runTiered(
    fetchTiered({
      ...contextEngineSave(name, profile),
      confirm: {
        title: `Use the ${name} context engine for ${profile}?`,
        text: `Hermes saves ${name} as the context engine of ${profile}. It decides how a long chat is compacted when the context fills up. New sessions use it; a chat that is already open keeps its engine.`,
        object: name,
        profile,
        confirmLabel: 'Use engine',
        recoverability: { undoable: true, note: 'Choose the other engine again to switch back.' },
      },
    }),
  );
}

/** Rewrites a node of the learning graph (T1). */
export async function saveNode(node: GraphNode, content: string, profile: string): Promise<ActionOutcome<{ message: string }>> {
  const outcome = await runTiered(
    fetchTiered({
      ...nodeSave(node.id, content, profile),
      confirm: {
        title: `Save the changes to “${node.label}”?`,
        text: node.kind === 'skill' ? `Hermes replaces the skill’s SKILL.md with this text.` : `Hermes rewrites this chunk in ${node.memorySource === 'profile' ? 'USER.md' : 'MEMORY.md'}. Caduceus keeps the file’s old text as a snapshot, so History can put it back.`,
        object: node.label,
        profile,
        confirmLabel: 'Save changes',
        recoverability: node.kind === 'memory' ? { undoable: true, note: 'The old text stays in History.' } : undefined,
      },
    }),
  );
  return outcome.kind === 'done' ? { kind: 'done', body: { message: readChange(outcome.body).message } } : outcome;
}

/** Deletes a node of the learning graph (T1): a skill is archived, a memory chunk is taken out of its file. */
export async function removeNode(node: GraphNode, profile: string): Promise<ActionOutcome<{ message: string }>> {
  const outcome = await runTiered(
    fetchTiered({
      ...nodeDelete(node.id, profile),
      confirm: {
        title: `Delete “${node.label}”?`,
        text: node.kind === 'skill' ? `Hermes archives the skill, so it leaves the profile’s skills. \`hermes curator restore ${node.id}\` brings it back.` : `Hermes takes this chunk out of ${node.memorySource === 'profile' ? 'USER.md' : 'MEMORY.md'}. Caduceus keeps the file’s old text as a snapshot, so History can put it back.`,
        object: node.label,
        profile,
        confirmLabel: 'Delete',
        recoverability: node.kind === 'skill' ? { undoable: true, note: `Run hermes curator restore ${node.id}.` } : { undoable: true, note: 'The old text stays in History.' },
      },
    }),
  );
  return outcome.kind === 'done' ? { kind: 'done', body: { message: readChange(outcome.body).message } } : outcome;
}
