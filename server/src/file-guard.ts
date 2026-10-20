// The file guard: Hermes's file endpoints take any path, so the policy proxy checks the path first. It closes two known
// Hermes gaps (architecture §5): `fs/write-text` and its siblings bypass Hermes's sensitive-path guard, and nothing
// stops a write outside the folders the owner means Hermes to use.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type FileCheck =
  | { ok: true; /** The path as Hermes will resolve it. */ path: string; /** It is inside a workspace Caduceus knows. */ inWorkspace: boolean }
  | { ok: false; reason: 'protected-path' | 'persistence-path' | 'secret-path' | 'outside-roots' | 'bad-path' };

/**
 * `read` is any path Hermes may read; `browse` is a read of the Files screen, which stays inside the allowed roots; `write` is a write, inside them too.
 * `relocate` is a rename or a move (M7 #02): a write, and the path must not be, or hold, an allowed root, Hermes's own home or Caduceus's directory.
 * `workspace` is a folder the owner registers as a workspace, where writes cost less: a write, and not the owner's home, Hermes's home or a folder that holds either.
 * `backup-output` is where a request asks Hermes to write a backup: only a `backups` folder of Hermes's home (or of a profile), which no other access reaches.
 */
export type FileAccess = 'read' | 'browse' | 'write' | 'relocate' | 'backup-output' | 'workspace';

export interface FileGuard {
  /**
   * Checks a path the way Hermes will resolve it. Protected files (Hermes's `.env` files and `auth.json`, anywhere, and
   * everything under Caduceus's own directory) fail for reads and writes. A write must also be inside the allowed roots.
   */
  check(rawPath: string, access: FileAccess): FileCheck;
}

export interface FileGuardOptions {
  /** The Hermes root home; Caduceus's data lives in its `caduceus/` directory. It is always an allowed root. */
  hermesRoot: string;
  /** The folders Hermes may write to. */
  roots: readonly string[];
  /** The workspaces Caduceus knows (the registry of M3 #10), where a raw write is a T1 rather than a T3. */
  workspaces?: () => readonly string[];
  /** The owner's home directory, which `~` means; defaults to this user's. */
  home?: string;
}

const MAX_LINK_HOPS = 40;

/** An archive by its name. A backup holds every key Hermes has, so these are never readable or movable through the file routes. */
const ARCHIVE_NAME = /\.(?:zip|tar|tgz|tar\.[a-z0-9]+)$/i;
/** What `hermes backup` calls its archive when no name is given: protected wherever it was left. */
/** Where the archives of a profile or board export (credentials are left out of them by Hermes: the owner downloads them from here) and of a profile import (the owner's own file, handed to Hermes) go. */
const TRANSFER_FOLDERS: ReadonlySet<string> = new Set(['profile-exports', 'board-exports', 'profile-imports']);
/** The files of the owner's home that a shell reads when it starts, and the git settings it reads: writing one is code at the next login. */
const HOME_STARTUP_FILE = /^\.(?:zsh|zlogin|zlogout|zprofile|bash|profile|gitconfig)/;
/** The folders of Hermes's home (and of each profile's) that hold what Hermes runs: hooks, cron scripts, skills and plugins. */
const HERMES_CODE_FOLDERS: ReadonlySet<string> = new Set(['hooks', 'scripts', 'skills', 'plugins']);
/** Folders under the owner's home (lower case, `/`-joined) that hold keys, cloud credentials and what a browser keeps of the owner's sign-ins. */
const HOME_SECRET_FOLDERS: readonly string[] = [
  '.ssh', '.aws', '.gnupg', '.azure', '.kube', '.docker', '.config/gh', '.config/gcloud', '.mozilla',
  '.config/google-chrome', '.config/chromium', '.config/bravesoftware', '.config/microsoft-edge',
  'library/keychains', 'library/safari', 'library/cookies',
  'library/application support/google/chrome', 'library/application support/chromium', 'library/application support/firefox',
  'library/application support/bravesoftware', 'library/application support/microsoft edge', 'library/application support/arc',
  'library/application support/vivaldi', 'library/application support/com.operasoftware.opera',
];
/** Files of the owner's home that are credentials by themselves. */
const HOME_SECRET_FILES: ReadonlySet<string> = new Set(['.netrc', '.npmrc', '.pypirc', '.pgpass', '.git-credentials']);
/** Private key files, wherever they sit. */
const PRIVATE_KEY_NAME = /^id_(?:rsa|dsa|ecdsa|ed25519)$/;
/** Credential stores of Hermes's home (the list its own Files screen refuses), by basename, and its credential folders, by any path part. */
const HERMES_SECRET_FILES: ReadonlySet<string> = new Set([
  'auth.lock', 'credentials', 'config.yaml', '.anthropic_oauth.json', 'google_token.json', 'google_oauth_pending.json', 'google_oauth.json',
  'webhook_subscriptions.json', 'bws_cache.json', 'bws_cache.enc.json', '.git-credentials',
]);
const HERMES_SECRET_FOLDERS: ReadonlySet<string> = new Set(['mcp-tokens', 'pairing']);
const BACKUP_NAME = /^hermes-backup.*\.(?:zip|tar|tgz|tar\.[a-z0-9]+)$/i;

/**
 * Resolves an absolute path the way POSIX (and Hermes's Python `Path.resolve(strict=False)`) does: component by
 * component, following symlinks, so `..` after a symlink leads out of the link's target and not back along the typed
 * path. Components that do not exist are kept as they are. Then the case of the part that exists is made canonical.
 */
function resolveLikeHermes(absolute: string): string | undefined {
  const queue = absolute.split('/').filter(Boolean);
  let resolved = '/';
  let hops = 0;
  while (queue.length > 0) {
    const part = queue.shift()!;
    if (part === '.') continue;
    if (part === '..') {
      resolved = path.dirname(resolved);
      continue;
    }
    const next = path.join(resolved, part);
    let isLink = false;
    try {
      isLink = fs.lstatSync(next).isSymbolicLink();
    } catch {
      // Not there (yet): the rest is taken literally.
      resolved = next;
      continue;
    }
    if (!isLink) {
      resolved = next;
      continue;
    }
    if (++hops > MAX_LINK_HOPS) return undefined;
    const target = fs.readlinkSync(next);
    if (path.isAbsolute(target)) resolved = '/';
    queue.unshift(...target.split('/').filter(Boolean));
  }
  // The file system may be case-insensitive (macOS): take the case it stores for what exists.
  let existing = resolved;
  const tail: string[] = [];
  for (;;) {
    try {
      return path.join(fs.realpathSync.native(existing), ...tail);
    } catch {
      const parent = path.dirname(existing);
      if (parent === existing) return resolved;
      tail.unshift(path.basename(existing));
      existing = parent;
    }
  }
}

export function createFileGuard({ hermesRoot, roots, workspaces = () => [], home = os.homedir() }: FileGuardOptions): FileGuard {
  const absolute = (raw: string): string | undefined => {
    const text = raw.trim();
    if (text === '' || text.includes('\0') || /^file:/i.test(text)) return undefined;
    const expanded = text === '~' ? home : text.startsWith('~/') ? path.join(home, text.slice(2)) : text;
    return path.isAbsolute(expanded) && !expanded.startsWith('~') ? resolveLikeHermes(expanded) : undefined;
  };
  const inside = (candidate: string, root: string) => candidate === root || candidate.startsWith(root.endsWith('/') ? root : `${root}/`);
  const resolvedAll = (paths: readonly string[]) => paths.flatMap((root) => absolute(root) ?? []);
  /** The folders Hermes writes its backups to: one in its home, one in each profile's. */
  const backupFolders = (): string[] => {
    let profiles: string[] = [];
    try {
      profiles = fs.readdirSync(path.join(hermesRoot, 'profiles'));
    } catch {
      // No profiles folder: only the default's.
    }
    return resolvedAll([path.join(hermesRoot, 'backups'), ...profiles.map((profile) => path.join(hermesRoot, 'profiles', profile, 'backups'))]);
  };

  /**
   * Whether a path (lower case, as resolved) is a place that runs code later: writing there is a foothold that survives the session.
   * `~/.config` is allowed inside a workspace the owner registered there, and nothing else is.
   */
  const runsLater = (lower: string): boolean => {
    const homeDir = absolute(home)?.toLowerCase();
    const within = (folder: string) => inside(lower, folder.toLowerCase());
    if (homeDir !== undefined && inside(lower, homeDir)) {
      const below = lower.slice(homeDir.length).split('/').filter(Boolean);
      const [first = '', second = ''] = below;
      if (below.length === 1 && HOME_STARTUP_FILE.test(first)) return true;
      if (first === '.ssh' || (first === 'library' && (second === 'launchagents' || second === 'launchdaemons'))) return true;
      if (first === '.config' && !resolvedAll(workspaces()).some((workspace) => inside(lower, workspace.toLowerCase()))) return true;
    }
    if (within('/Library/LaunchAgents') || within('/Library/LaunchDaemons')) return true;
    const parts = lower.split('/');
    const dotGit = parts.indexOf('.git');
    if (dotGit >= 0 && (parts[dotGit + 1] === 'hooks' || parts[dotGit + 1] === 'config')) return true;
    const hermes = absolute(hermesRoot)?.toLowerCase();
    if (hermes !== undefined && inside(lower, hermes)) {
      const [top = '', profile = '', code = ''] = lower.slice(hermes.length).split('/').filter(Boolean).slice(0, 3);
      return HERMES_CODE_FOLDERS.has(top) || (top === 'profiles' && profile !== '' && HERMES_CODE_FOLDERS.has(code));
    }
    return false;
  };

  /** Whether a path (lower case, as resolved) holds keys or credentials: reading it is never an ordinary file read. */
  const holdsSecrets = (lower: string): boolean => {
    const name = path.basename(lower);
    if (PRIVATE_KEY_NAME.test(name)) return true;
    const hermesHome = absolute(hermesRoot)?.toLowerCase();
    const inHermes = hermesHome !== undefined && inside(lower, hermesHome);
    // `credentials` and the like are secret anywhere; `config.yaml` only in Hermes's own home, where it holds provider keys.
    if (HERMES_SECRET_FILES.has(name) && (inHermes || name !== 'config.yaml')) return true;
    const homeDir = absolute(home)?.toLowerCase();
    if (homeDir !== undefined && inside(lower, homeDir)) {
      const below = lower.slice(homeDir.length).replace(/^\//, '');
      if (HOME_SECRET_FILES.has(below)) return true;
      if (HOME_SECRET_FOLDERS.some((folder) => below === folder || below.startsWith(`${folder}/`))) return true;
    }
    if (hermesHome !== undefined && inHermes) {
      const below = lower.slice(hermesHome.length).split('/').filter(Boolean);
      if (below.some((part) => HERMES_SECRET_FOLDERS.has(part))) return true;
      // The vault: its key and its encrypted store, in Hermes's home or a profile's.
      if (name.startsWith('vault') && (below.length === 1 || (below[0] === 'profiles' && below.length === 3))) return true;
    }
    return false;
  };

  return {
    check(rawPath, access) {
      const resolved = absolute(rawPath);
      if (!resolved) return { ok: false, reason: 'bad-path' };
      const name = path.basename(resolved).toLowerCase();
      const caduceus = absolute(path.join(hermesRoot, 'caduceus'))?.toLowerCase();
      const keyFile = name === '.env' || name.startsWith('.env.') || name === '.envrc' || name === 'auth.json';
      if (keyFile || (caduceus !== undefined && inside(resolved.toLowerCase(), caduceus))) return { ok: false, reason: 'protected-path' };
      const lower = resolved.toLowerCase();
      const backups = backupFolders();
      const inBackups = backups.some((folder) => inside(lower, folder.toLowerCase()));
      if (access === 'backup-output') return inBackups ? { ok: true, path: resolved, inWorkspace: false } : { ok: false, reason: 'protected-path' };
      // A backup archive, wherever it is: a zip in Hermes's home (but not an export Hermes made for the owner to download or an import the owner uploaded), anything in a backups folder, or what `hermes backup` names its file.
      const archive = ARCHIVE_NAME.test(name) && !TRANSFER_FOLDERS.has(path.basename(path.dirname(resolved)).toLowerCase());
      const inHome = resolvedAll([hermesRoot]).some((root) => inside(resolved, root));
      if (inBackups || (archive && inHome) || BACKUP_NAME.test(name)) return { ok: false, reason: 'protected-path' };
      const secret = holdsSecrets(lower);
      if (access === 'read') return secret ? { ok: false, reason: 'secret-path' } : { ok: true, path: resolved, inWorkspace: false };
      if (!resolvedAll([...roots, hermesRoot]).some((root) => inside(resolved, root))) return { ok: false, reason: 'outside-roots' };
      if (access === 'workspace' && [home, hermesRoot].some((kept) => { const folder = absolute(kept)?.toLowerCase(); return folder !== undefined && inside(folder, lower); })) return { ok: false, reason: 'protected-path' };
      if ((access === 'write' || access === 'relocate' || access === 'workspace') && runsLater(lower)) return { ok: false, reason: 'persistence-path' };
      if (secret) return { ok: false, reason: 'secret-path' };
      if (access === 'browse') return { ok: true, path: resolved, inWorkspace: false };
      // Moving a folder moves everything in it: not one that holds Hermes's home or Caduceus's data, and not a root itself.
      if (access === 'relocate') {
        const caduceusDir = absolute(path.join(hermesRoot, 'caduceus'));
        const held = [...resolvedAll(roots), ...resolvedAll(workspaces()), ...resolvedAll([hermesRoot]), ...(caduceusDir ? [caduceusDir] : []), ...backups].some((kept) => inside(kept, resolved));
        if (held) return { ok: false, reason: 'protected-path' };
      }
      // A workspace's files cost less to write, and so do the owner's own profile imports: Caduceus stages the archive in Hermes's `profile-imports` folder for Hermes to read, then deletes it.
      const staging = access !== 'relocate' && path.basename(path.dirname(resolved)).toLowerCase() === 'profile-imports' && inside(lower, (absolute(hermesRoot) ?? hermesRoot).toLowerCase());
      return { ok: true, path: resolved, inWorkspace: staging || resolvedAll(workspaces()).some((workspace) => inside(resolved, workspace)) };
    },
  };
}
