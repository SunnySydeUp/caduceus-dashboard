// Where the Hermes root home is. Kept apart from the store so that the setup command can ask without loading SQLite.
import os from 'node:os';
import path from 'node:path';

/**
 * The Hermes root home, as Hermes's `get_default_hermes_root()` resolves it: `~/.hermes` when HERMES_HOME is unset
 * or inside it (a profile), `<root>` for a custom `<root>/profiles/<name>`, otherwise HERMES_HOME itself.
 * `homeDir` is the user's home directory; the setup command, which acts for a user it was handed, names it.
 */
export function hermesRootHome(env: NodeJS.ProcessEnv, homeDir: string = os.homedir()): string {
  const native = path.join(homeDir, '.hermes');
  const home = env.HERMES_HOME?.trim();
  if (!home) return native;
  const resolved = path.resolve(home === '~' || home.startsWith('~/') ? path.join(homeDir, home.slice(1)) : home);
  const fromNative = path.relative(native, resolved);
  if (!fromNative.startsWith('..') && !path.isAbsolute(fromNative)) return native;
  return path.basename(path.dirname(resolved)) === 'profiles' ? path.dirname(path.dirname(resolved)) : resolved;
}
