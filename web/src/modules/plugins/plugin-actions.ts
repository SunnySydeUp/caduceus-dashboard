// The changes System › Plugins makes, each through `fetchTiered` with the tier the policy map gives the route: turning a plugin on or off and
// removing it are Tier 1 (Hermes's own routes), installing and updating are Tier 3 (git-installed Python; Caduceus runs Hermes's command so the
// log can stream). The caller shows toasts and reloads; this says what happened. A change that needs the gateway restarted raises the
// restart-to-apply banner. Caduceus keeps nothing of what it sends.
import { raiseRestartNeeded } from '../../restart-to-apply.ts';
import { fetchTiered } from '../../tiered.ts';
import { runTiered, type ActionOutcome } from '../profiles/profile-actions.ts';
import { disableRequest, enableRequest, installRequest, removeRequest, updateRequest, type InstallOptions, type PluginRow, type ValidSource } from './plugins-model.ts';

/** Plugins live in the Hermes home, which is the default profile's: its gateway is the one that loads them. */
const GATEWAY_PROFILE = 'default';

/** Hermes loads plugins when a gateway starts, so a change takes effect at its next restart. */
export const raisePluginRestart = (reason: string) => raiseRestartNeeded(GATEWAY_PROFILE, reason);

/** Turns a plugin on or off (Tier 1). */
export async function setPluginEnabled(plugin: PluginRow, enabled: boolean): Promise<ActionOutcome> {
  const outcome = await runTiered(
    fetchTiered({
      ...(enabled ? enableRequest(plugin.name) : disableRequest(plugin.name)),
      confirm: {
        title: `Turn ${enabled ? 'on' : 'off'} ${plugin.name}?`,
        text: enabled
          ? 'Hermes adds it to the plugins it loads. Its code runs the next time a gateway starts.'
          : 'Hermes stops loading it. It stays installed, and turning it on again puts it back.',
        object: plugin.name,
        profile: GATEWAY_PROFILE,
        confirmLabel: enabled ? 'Turn on' : 'Turn off',
      },
    }),
  );
  if (outcome.kind === 'done') await raisePluginRestart(`Plugin ${plugin.name} turned ${enabled ? 'on' : 'off'}`);
  return outcome;
}

/** Deletes an installed plugin from the Hermes home (Tier 1). */
export async function removePlugin(plugin: PluginRow): Promise<ActionOutcome> {
  const outcome = await runTiered(
    fetchTiered({
      ...removeRequest(plugin.name),
      confirm: {
        title: `Remove ${plugin.name}?`,
        text: 'Hermes deletes the plugin’s folder from this Mac and stops loading it. Anything it saved elsewhere stays.',
        object: plugin.name,
        profile: GATEWAY_PROFILE,
        confirmLabel: 'Remove plugin',
      },
    }),
  );
  if (outcome.kind === 'done') await raisePluginRestart(`Plugin ${plugin.name} removed`);
  return outcome;
}

/** What an install or update starts: the id of the operation whose log to follow. */
export interface Started {
  id: string;
}

/**
 * Installs a plugin (Tier 3: a passkey, then typing the address or the name). Hermes clones it, checks it and installs what it depends on while
 * the log streams; the answer names the log to follow.
 */
export function installPlugin(source: ValidSource, options: InstallOptions): Promise<ActionOutcome<Started>> {
  const request = installRequest(source, options);
  const catalogue = source.kind === 'catalogue';
  return runTiered<Started>(
    fetchTiered({
      method: request.method,
      path: request.path,
      body: request.body,
      confirm: {
        title: `Install ${request.confirmTarget}?`,
        text: catalogue
          ? 'Hermes installs this catalogue plugin at the exact commit the catalogue pins, then installs the Python packages it needs. The catalogue is reviewed, but the plugin is still code that runs on this Mac with the permissions of Hermes.'
          : 'Hermes downloads this repository, scans it, and installs the Python packages it needs. Hermes has not reviewed it: it is code that runs on this Mac with the permissions of Hermes. Only continue if you trust where it comes from.',
        object: request.confirmTarget,
        profile: GATEWAY_PROFILE,
        confirmLabel: 'Install plugin',
        recoverability: { undoable: true, note: 'Remove deletes it again. Whatever it did while it ran is not undone.' },
      },
    }),
  );
}

/** Updates a git-installed plugin (Tier 3): Hermes pulls its newest code, or re-pins a catalogue plugin to the catalogue's commit. */
export function updatePlugin(plugin: PluginRow): Promise<ActionOutcome<Started>> {
  const request = updateRequest(plugin.name);
  return runTiered<Started>(
    fetchTiered({
      method: request.method,
      path: request.path,
      body: request.body,
      confirm: {
        title: `Update ${plugin.name}?`,
        text: 'Hermes pulls the newest code from the plugin’s repository and checks it again. The new code is Python that runs on this Mac, and Hermes does not review what the author changed.',
        object: request.confirmTarget,
        profile: GATEWAY_PROFILE,
        confirmLabel: 'Update plugin',
        recoverability: { undoable: false, note: 'Hermes keeps no copy of the version it replaces.' },
      },
    }),
  );
}
