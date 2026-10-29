// The changes Agents › Skills makes in Hermes, each through `fetchTiered` with the tier the policy map gives the route (switch T0,
// create and save T1, hub uninstall T1, local delete T1; all of them blocked in read-only mode). The caller shows toasts and
// reloads; this says what happened. Caduceus keeps nothing of what it sends.
import { fetchTiered } from '../../tiered.ts';
import { runTiered, type ActionOutcome } from '../profiles/profile-actions.ts';
import { actionPath, createRequest, deleteRequest, readActionOutcome, readDeleteAnswer, saveRequest, toggleRequest, uninstallRequest } from './skills-model.ts';

/** Switches a skill on or off for the profile. Tier 0: no dialog; the caller's toast offers the undo. */
export function setSkillEnabled(profile: string, name: string, enabled: boolean): Promise<ActionOutcome> {
  return runTiered(fetchTiered(toggleRequest(profile, name, enabled)));
}

/** Creates a skill from a whole SKILL.md text. */
export function createSkill(profile: string, input: { name: string; category: string; content: string }, onConfirmed?: () => void): Promise<ActionOutcome> {
  return runTiered(
    fetchTiered({
      ...createRequest(profile, input),
      onConfirmed,
      confirm: {
        title: `Create the skill ${input.name} in ${profile}?`,
        text: `Hermes writes the SKILL.md you composed${input.category.trim() ? ` in the ${input.category.trim()} category` : ''}. The agent can use it from the next session.`,
        object: input.name,
        profile,
        confirmLabel: 'Create skill',
      },
    }),
  );
}

/** Replaces a skill's SKILL.md with the text the editor holds. */
export function saveSkill(profile: string, name: string, content: string, onConfirmed?: () => void): Promise<ActionOutcome> {
  return runTiered(
    fetchTiered({
      ...saveRequest(profile, name, content),
      onConfirmed,
      confirm: {
        title: `Save the SKILL.md of ${name} in ${profile}?`,
        text: 'Hermes replaces the file with this text, exactly as you see it. The frontmatter is not rewritten.',
        object: name,
        profile,
        confirmLabel: 'Save SKILL.md',
      },
    }),
  );
}

/** How long to wait between two looks at a background action of Hermes: it is a process of its own, and there is no event to wait for. */
const ACTION_LOOK_MS = 400;
/** About a minute: a hub uninstall removes a folder and a record. */
const ACTION_LOOKS = 150;

/** Looks at one of Hermes's background actions until it has finished. */
async function untilFinished(name: string): Promise<{ ok: true } | { ok: false; message: string }> {
  for (let look = 0; look < ACTION_LOOKS; look++) {
    const res = await fetch(actionPath(name));
    const outcome = res.ok ? readActionOutcome(await res.json()) : ({ kind: 'running' } as const);
    if (outcome.kind === 'done') return { ok: true };
    if (outcome.kind === 'failed') return { ok: false, message: outcome.message };
    const pause = Promise.withResolvers<void>();
    window.setTimeout(pause.resolve, ACTION_LOOK_MS);
    await pause.promise;
  }
  return { ok: false, message: 'Hermes is still uninstalling it. Look at the list again in a moment.' };
}

/** Uninstalls a hub skill: the owner confirms (Tier 1), Hermes runs its own uninstall for the profile, and this waits until it has finished. */
export async function uninstallSkill(profile: string, name: string): Promise<ActionOutcome<{ message?: string }>> {
  const started = await runTiered<{ name?: string }>(
    fetchTiered({
      ...uninstallRequest(profile, name),
      confirm: {
        title: `Uninstall ${name} from ${profile}?`,
        text: 'Hermes removes the skill’s folder and its record from this profile’s skills. Other profiles keep theirs. You can install it again from the hub.',
        object: name,
        profile,
        confirmLabel: 'Uninstall',
      },
    }),
  );
  if (started.kind !== 'done') return started;
  if (!started.body.name) return { kind: 'failed', message: 'Hermes did not say which action it started, so Caduceus cannot tell whether the uninstall worked.' };
  const finished = await untilFinished(started.body.name);
  return finished.ok ? { kind: 'done', body: {} } : { kind: 'failed', message: finished.message };
}

/** Deletes a local skill: the owner confirms (Tier 1), Hermes archives it. Its answer says how to bring it back. */
export async function deleteSkill(profile: string, name: string): Promise<ActionOutcome<{ message?: string }>> {
  const outcome = await runTiered(
    fetchTiered({
      ...deleteRequest(profile, name),
      confirm: {
        title: `Delete ${name} from ${profile}?`,
        text: 'Hermes archives the skill, so the agent no longer sees it. Bringing it back needs Hermes’s command line: hermes curator restore.',
        object: name,
        profile,
        confirmLabel: 'Delete skill',
      },
    }),
  );
  if (outcome.kind !== 'done') return outcome;
  const answer = readDeleteAnswer(outcome.body);
  return answer.ok ? { kind: 'done', body: { message: answer.message } } : { kind: 'failed', message: answer.message || 'Hermes did not delete the skill.' };
}
