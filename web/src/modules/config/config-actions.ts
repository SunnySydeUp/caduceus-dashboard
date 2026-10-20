// The one change System › Config makes in Hermes: saving the edited keys (`PUT /api/config`, Tier 3: the profile's name is typed to
// confirm, because config can switch on ways to run code). The caller shows toasts and reloads; this says what happened. Caduceus keeps
// nothing of what it sends, and no value is ever put in a message or a toast: keys only.
import { raiseRestartNeeded } from '../../restart-to-apply.ts';
import { fetchTiered } from '../../tiered.ts';
import { runTiered, type ActionOutcome } from '../profiles/profile-actions.ts';
import { migrateOutput, rawSaveRequest } from './config-yaml.ts';
import { configUpdateRequest, type ConfigField, type ConfigValue } from './config-model.ts';

/** What came of a save: the keys that were saved and the ones among them that wait for a gateway restart. */
export interface ConfigSaved {
  saved: string[];
  restart: string[];
}

/** The keys in a sentence: the first few, then how many more. */
function keyList(keys: readonly string[]): string {
  return keys.length <= 3 ? keys.join(', ') : `${keys.slice(0, 3).join(', ')} and ${keys.length - 3} more`;
}

/**
 * Saves the edits waiting in `pending` for `profile` (T3). When a key among them is read only when the gateway starts, the restart-to-apply
 * banner is raised for the profile (`restart-to-apply.ts`), which offers the restart in place.
 */
export async function saveConfig(profile: string, fields: readonly ConfigField[], pending: ReadonlyMap<string, ConfigValue>): Promise<ActionOutcome<ConfigSaved>> {
  const saved = fields.filter((field) => pending.has(field.key)).map((field) => field.key);
  const restart = fields.filter((field) => pending.has(field.key) && field.restartRequired).map((field) => field.key);
  const request = configUpdateRequest(profile, pending);
  const outcome = await runTiered(
    fetchTiered({
      ...request,
      confirm: {
        title: `Save ${saved.length === 1 ? '1 config change' : `${saved.length} config changes`} for ${profile}?`,
        text: `Hermes writes ${keyList(saved)} to the profile’s config. Config can switch on ways to run commands, so check the review first.${restart.length > 0 ? ' A gateway restart applies some of it.' : ''}`,
        object: profile,
        profile,
        confirmLabel: 'Save config',
        recoverability: { undoable: true, note: 'Hermes keeps no copy of the old values: set them back by hand. A credential that is replaced cannot be read back.' },
      },
    }),
  );
  if (outcome.kind !== 'done') return outcome;
  if (restart.length > 0) await raiseRestartNeeded(profile, `Config saved: ${keyList(restart)}`);
  return { kind: 'done', body: { saved, restart } };
}

/** What a raw save is for, in the confirmation. */
export interface RawSaveWords {
  title: string;
  text: string;
  confirmLabel: string;
}

/**
 * Replaces the profile's whole config file by `text` (`PUT /api/config/raw`, Tier 3): the raw editor's save, an applied import and a
 * reset are this one request. `restart` are the keys among those it changes that wait for a gateway restart. The server keeps a credential
 * that the text masks; a mask with nothing to stand for is refused there, in words.
 */
export async function saveRawConfig(profile: string, text: string, words: RawSaveWords, restart: readonly string[]): Promise<ActionOutcome<{ restart: string[] }>> {
  const outcome = await runTiered(
    fetchTiered({
      ...rawSaveRequest(profile, text),
      confirm: {
        title: words.title,
        text: `${words.text} Hermes replaces the whole file, so a setting that is not in the text goes back to its default. Config can switch on ways to run commands, so check the review first.`,
        object: profile,
        profile,
        confirmLabel: words.confirmLabel,
        recoverability: { undoable: true, note: 'Hermes keeps no copy of the old file: export it first to keep one. A credential the text replaces cannot be read back.' },
      },
    }),
  );
  if (outcome.kind !== 'done') return outcome;
  if (restart.length > 0) await raiseRestartNeeded(profile, `Config saved: ${keyList(restart)}`);
  return { kind: 'done', body: { restart: [...restart] } };
}

/** How long to wait between two looks at Hermes's migrate: it is a process of its own, and there is no event to wait for. */
const MIGRATE_LOOK_MS = 400;
/** About a minute. */
const MIGRATE_LOOKS = 150;

/** What Hermes's config migrate printed, and how it ended. */
export interface MigrateRun {
  lines: string[];
  exitCode: number | null;
}

/** Runs Hermes's own `config migrate` for the profile (Tier 1) and waits for it to end, then gives what it printed. */
export async function migrateConfig(profile: string): Promise<ActionOutcome<MigrateRun>> {
  const started = await runTiered<{ name?: string }>(
    fetchTiered({
      method: 'POST',
      path: `/api/ops/config-migrate?profile=${encodeURIComponent(profile)}`,
      body: {},
      confirm: {
        title: `Run config migrate for ${profile}?`,
        text: 'Hermes adds the settings a newer version introduced to the profile’s config and moves renamed ones. It prints what it did.',
        object: profile,
        profile,
        confirmLabel: 'Run migrate',
      },
    }),
  );
  if (started.kind !== 'done') return started;
  const name = started.body.name ?? 'config-migrate';
  for (let look = 0; look < MIGRATE_LOOKS; look++) {
    const res = await fetch(`/api/actions/${encodeURIComponent(name)}/status?lines=500`);
    const body: unknown = res.ok ? await res.json().catch(() => undefined) : undefined;
    if (typeof body === 'object' && body !== null && 'running' in body && body.running === false) {
      const lines = 'lines' in body && Array.isArray(body.lines) ? body.lines.filter((line): line is string => typeof line === 'string') : [];
      return { kind: 'done', body: { lines: migrateOutput(lines), exitCode: 'exit_code' in body && typeof body.exit_code === 'number' ? body.exit_code : null } };
    }
    const pause = Promise.withResolvers<void>();
    window.setTimeout(pause.resolve, MIGRATE_LOOK_MS);
    await pause.promise;
  }
  return { kind: 'failed', message: 'Hermes is still running config migrate. Its output is in Hermes’s action log; look again in a moment.' };
}
