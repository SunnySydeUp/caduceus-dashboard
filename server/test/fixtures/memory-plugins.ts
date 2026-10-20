// The memory providers Hermes 0.22 no longer carries. Hermes keeps ByteRover and RetainDB in its tree; Hindsight, Honcho, Holographic, Mem0,
// Supermemory and OpenViking are plugins a profile installs from the plugin catalogue (`hermes plugins install <name>`) into its own
// `<HERMES_HOME>/plugins/<name>`. A test home has no network, so `memory-plugins/<name>/` holds a small plugin of the same name that has what
// Hermes's memory routes and Caduceus read of the real one (see the top of each `__init__.py`). Hermes looks for a memory plugin in the home
// of the profile it answers for, so each profile that needs one gets a copy.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE = fileURLToPath(new URL('./memory-plugins/', import.meta.url));

export type MemoryPluginName = 'hindsight' | 'honcho' | 'holographic' | 'mem0';

/** Puts the named plugins in a profile's home (`home` itself for the default profile, `<home>/profiles/<name>` for another). */
export function installMemoryPlugins(profileHome: string, names: MemoryPluginName[]): void {
  for (const name of names) fs.cpSync(path.join(SOURCE, name), path.join(profileHome, 'plugins', name), { recursive: true });
}
