// The changes Agents › Skills › Hub and the curator make in Hermes, each through `fetchTiered` with the tier the policy map gives the
// route (install and Update all T3, Pause and Resume T1, Run now T2; all of them blocked in read-only mode, the T3 ones and Run now
// offline too). The caller shows the log and toasts; this says what happened. Caduceus keeps nothing of what it sends.
import { fetchTiered } from '../../tiered.ts';
import { runTiered, type ActionOutcome } from '../profiles/profile-actions.ts';
import { installRequest, pauseRequest, runCuratorRequest, startedAction, updateRequest, type HubScan, type InstallGate } from './hub-model.ts';

/** What a request that Hermes runs in the background answered: the name of the action whose log to follow. */
export type Started = ActionOutcome<{ action: string }>;

async function started(sending: Promise<ActionOutcome>, what: string): Promise<Started> {
  const outcome = await sending;
  if (outcome.kind !== 'done') return outcome;
  const action = startedAction(outcome.body);
  return action ? { kind: 'done', body: { action } } : { kind: 'failed', message: `Hermes did not say which action it started, so Caduceus cannot follow ${what}.` };
}

/** The words of the typed confirmation that overrides a scan verdict Hermes allows although it is not safe. */
export const overridePhrase = (name: string) => `override ${name}`;

const verdictWords = (scan: HubScan) => {
  const { critical, high, medium, low } = scan.counts;
  const counts = [critical && `${critical} critical`, high && `${high} high`, medium && `${medium} medium`, low && `${low} low`].filter(Boolean).join(', ');
  return `${scan.verdict}${counts ? ` (${counts})` : ''}`;
};

/**
 * Installs a hub skill into the profile: the owner confirms (Tier 3: passkey, then typing the skill's name, or, for a verdict that is
 * not safe, typing `override <name>`), Hermes downloads, scans and copies it in its own process, and the answer names the action whose log to follow.
 */
export function installHubSkill(profile: string, skill: { name: string; identifier: string }, scan: HubScan, gate: Extract<InstallGate, { kind: 'ready' | 'override' }>): Promise<Started> {
  const override = gate.kind === 'override';
  return started(
    runTiered(
      fetchTiered({
        ...installRequest(profile, skill.identifier),
        confirm: {
          title: override ? `Install ${skill.name} into ${profile}, although the scan is not clean?` : `Install ${skill.name} into ${profile}?`,
          text: override
            ? `Hermes’s security scan found: ${verdictWords(scan)}. Hermes allows this source, so the install can go ahead, but the skill is text the agent will follow and files it may run. Read the findings first. Typing the phrase below is your explicit override.`
            : 'Hermes downloads the skill, scans it again, and copies it into this profile’s skills. The agent can use it from the next session. The scan found nothing.',
          object: override ? overridePhrase(skill.name) : skill.name,
          profile,
          confirmLabel: override ? 'Install anyway' : 'Install skill',
          recoverability: { undoable: true, note: 'Uninstall removes it from this profile again.' },
        },
      }),
    ),
    'the install',
  );
}

/** Updates every hub skill of the profile that has a newer version: the owner confirms (Tier 3), Hermes runs its own update. A skill whose files you edited is left as it is. */
export function updateAllHubSkills(profile: string): Promise<Started> {
  return started(
    runTiered(
      fetchTiered({
        ...updateRequest(profile),
        confirm: {
          title: `Update all hub skills in ${profile}?`,
          text: 'Hermes looks for newer versions of the skills installed from the hub and installs them over the old ones. A skill whose files you changed is skipped and named in the log.',
          object: profile,
          profile,
          confirmLabel: 'Update all',
          recoverability: { undoable: false, note: 'The older versions are replaced; Hermes keeps no copy.' },
        },
      }),
    ),
    'the update',
  );
}

/** Pauses or resumes the profile's curator (Tier 1). */
export function setCuratorPaused(profile: string, paused: boolean): Promise<ActionOutcome> {
  return runTiered(
    fetchTiered({
      ...pauseRequest(profile, paused),
      confirm: {
        title: paused ? `Pause the curator of ${profile}?` : `Resume the curator of ${profile}?`,
        text: paused ? 'Hermes stops starting curator reviews for this profile by itself. Run now still works.' : 'Hermes goes back to starting curator reviews for this profile by itself when its schedule says.',
        object: profile,
        profile,
        confirmLabel: paused ? 'Pause curator' : 'Resume curator',
      },
    }),
  );
}

/** Runs a curator review now: the owner confirms with a passkey (Tier 2), and Hermes reviews the profile’s skills in its own process. */
export function runCuratorNow(profile: string): Promise<Started> {
  return started(
    runTiered(
      fetchTiered({
        ...runCuratorRequest(profile),
        confirm: {
          title: `Run the curator on ${profile} now?`,
          text: 'Hermes reviews the skills it manages in this profile now: a skill left unused goes stale, then is archived. Nothing is deleted, pinned skills are left alone, and an archived skill comes back with hermes curator restore. Hermes merges skills with a model only if its curator.consolidate setting is on.',
          object: profile,
          profile,
          confirmLabel: 'Run now',
        },
      }),
    ),
    'the review',
  );
}
