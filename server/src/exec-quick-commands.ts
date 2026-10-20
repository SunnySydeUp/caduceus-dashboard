// Which slash commands run a shell command. Hermes keeps user-defined quick commands in each profile's config
// (`quick_commands`), and runs the ones of `type: exec` with `shell=True` when `command.dispatch` names them. Only the
// config knows, so the policy proxy asks it.
import { isRecord } from '@caduceus/contracts/policy/guards';
import type { HermesBackend } from './hermes-backend.ts';

async function getJson(backend: HermesBackend, route: string): Promise<unknown> {
  const res = await backend.fetch(route);
  if (!res.ok) throw new Error(`Reading ${route} from Hermes failed: HTTP ${res.status}`);
  return res.json();
}

/**
 * The names (lower case) of the exec-type quick commands in every profile's config. A name in any profile counts: a session
 * of one profile can run a command of the profile it resolves to, and the policy cannot always tell which that is.
 * Rejects when Hermes cannot be asked, so that a failed lookup is never taken for "none".
 */
export async function execQuickCommandNames(backend: HermesBackend): Promise<Set<string>> {
  const listed = await getJson(backend, '/api/profiles');
  const profiles = isRecord(listed) && Array.isArray(listed.profiles) ? listed.profiles : [];
  const names = new Set<string>();
  for (const profile of profiles) {
    if (!isRecord(profile) || typeof profile.name !== 'string') continue;
    const config = await getJson(backend, `/api/config?profile=${encodeURIComponent(profile.name)}`);
    const quickCommands = isRecord(config) && isRecord(config.quick_commands) ? config.quick_commands : {};
    for (const [name, command] of Object.entries(quickCommands)) {
      if (isRecord(command) && command.type === 'exec') names.add(name.toLowerCase());
    }
  }
  return names;
}
