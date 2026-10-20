import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFileGuard, type FileGuard } from '../src/file-guard.ts';

// The file guard is a pure domain module over the file system: it decides which paths Hermes's file endpoints may
// touch. It resolves symlinks and `..` as Hermes will, so these tests build real directories.
let base: string;
let dirs: { hermesRoot: string; home: string; workspace: string; outside: string };
let guard: FileGuard;

beforeEach(() => {
  // realpath: on macOS the temp dir is itself reached through a symlink (/var → /private/var).
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-guard-')));
  const at = (...parts: string[]) => {
    const dir = path.join(base, ...parts);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  };
  dirs = { home: at('home'), hermesRoot: at('home', '.hermes'), workspace: at('home', 'work', 'project'), outside: at('elsewhere') };
  at('home', '.hermes', 'caduceus');
  at('home', '.hermes', 'profiles', 'coder');
  fs.writeFileSync(path.join(dirs.hermesRoot, '.env'), 'KEY=secret\n');
  fs.writeFileSync(path.join(dirs.hermesRoot, 'caduceus', 'caduceus.db'), '');
  guard = createFileGuard({ hermesRoot: dirs.hermesRoot, roots: [dirs.home], home: dirs.home, workspaces: () => [dirs.workspace] });
});
afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

/** What the guard says of a path for a write, as one line: `ok`, `ok in workspace` or the refusal. */
function writing(raw: string): string {
  const check = guard.check(raw, 'write');
  return check.ok ? `ok${check.inWorkspace ? ' in workspace' : ''}` : check.reason;
}

describe('the file guard', () => {
  test('lets a write through inside the allowed roots, and says when it is inside a known workspace', () => {
    expect([
      writing(path.join(dirs.home, 'notes.md')),
      writing(path.join(dirs.home, 'Documents', 'new', 'file.txt')),
      writing(path.join(dirs.workspace, 'src', 'main.ts')),
      writing(path.join(dirs.hermesRoot, 'profiles', 'coder', 'AGENTS.md')),
      writing('~/notes.md'),
      writing('~'),
    ]).toEqual(['ok', 'ok', 'ok in workspace', 'ok', 'ok', 'ok']);
  });

  test("refuses Hermes's keys, its sign-in file and Caduceus's own directory, whatever the case or the route to them", () => {
    fs.symlinkSync(path.join(dirs.hermesRoot, '.env'), path.join(dirs.home, 'innocent.txt'));
    fs.symlinkSync(path.join(dirs.hermesRoot, 'caduceus'), path.join(dirs.workspace, 'data'));
    const protectedPaths = [
      path.join(dirs.hermesRoot, '.env'),
      path.join(dirs.hermesRoot, '.ENV'),
      path.join(dirs.hermesRoot, '.env.local'),
      path.join(dirs.hermesRoot, 'auth.json'),
      path.join(dirs.hermesRoot, 'Auth.JSON'),
      path.join(dirs.hermesRoot, 'profiles', 'coder', '.env'),
      path.join(dirs.hermesRoot, 'profiles', 'coder', 'auth.json'),
      path.join(dirs.hermesRoot, 'caduceus'),
      path.join(dirs.hermesRoot, 'caduceus', 'caduceus.db'),
      path.join(dirs.hermesRoot, 'caduceus', 'caduceus.db-wal'),
      path.join(dirs.hermesRoot, 'CADUCEUS', 'anything'),
      // `..` that leads back into it, a symlink to the key file, and one through a symlinked directory.
      `${dirs.home}/work/../.hermes/.env`,
      path.join(dirs.home, 'innocent.txt'),
      path.join(dirs.workspace, 'data', 'caduceus.db'),
      '~/.hermes/.env',
    ];

    expect(protectedPaths.map(writing)).toEqual(Array(protectedPaths.length).fill('protected-path'));
    // Like Hermes's own read guard, the key files are protected wherever they sit: a project's `.env` too.
    expect([writing(path.join(dirs.workspace, '.env')), writing(path.join(dirs.workspace, '.envrc')), writing(path.join(dirs.workspace, 'environment.md'))]).toEqual([
      'protected-path',
      'protected-path',
      'ok in workspace',
    ]);
  });

  test('refuses a write outside the allowed roots, however it gets there', () => {
    fs.symlinkSync(dirs.outside, path.join(dirs.home, 'portal'));
    // `..` after a symlink leaves the link's target, not the typed path: this is `elsewhere/x.txt`, not `home/x.txt`.
    fs.mkdirSync(path.join(dirs.outside, 'deep'));
    fs.symlinkSync(path.join(dirs.outside, 'deep'), path.join(dirs.home, 'tunnel'));

    expect([
      writing(path.join(dirs.outside, 'x.txt')),
      writing('/etc/hosts'),
      writing(`${dirs.home}/work/../../elsewhere/x.txt`),
      writing(path.join(dirs.home, 'portal', 'x.txt')),
      writing(`${dirs.home}/tunnel/../x.txt`),
      // A root's neighbour that merely shares its name as a prefix.
      writing(`${dirs.home}-other/x.txt`),
    ]).toEqual(Array(6).fill('outside-roots'));
  });

  test('refuses a path it cannot resolve exactly: relative, a file: URL, another user, empty or with a NUL', () => {
    expect(['notes.md', './notes.md', 'file:///etc/hosts', 'FILE:///x', '~root/x', '', '   ', `${dirs.home}/a\0b`].map(writing)).toEqual(Array(8).fill('bad-path'));
  });

  test('guards a read from the protected files too, but not from the roots: reading is what Hermes is for', () => {
    const reading = (raw: string) => {
      const check = guard.check(raw, 'read');
      return check.ok ? 'ok' : check.reason;
    };

    expect([
      reading(path.join(dirs.hermesRoot, 'caduceus', 'caduceus.db')),
      reading(path.join(dirs.hermesRoot, '.env')),
      reading(path.join(dirs.outside, 'x.txt')),
      reading('/etc/hosts'),
      reading(path.join(dirs.home, 'notes.md')),
    ]).toEqual(['protected-path', 'protected-path', 'ok', 'ok', 'ok']);
  });

  test('keeps backup archives out of every file route, and lets a backup be written only to a backups folder', () => {
    fs.mkdirSync(path.join(dirs.hermesRoot, 'backups'));
    fs.mkdirSync(path.join(dirs.hermesRoot, 'profiles', 'coder', 'backups'));
    fs.symlinkSync(path.join(dirs.hermesRoot, 'backups', 'a.zip'), path.join(dirs.workspace, 'innocent.zip'));
    const every = (raw: string) => (['read', 'browse', 'write', 'relocate'] as const).map((access) => { const check = guard.check(raw, access); return check.ok ? 'ok' : check.reason; });
    const archives = [
      path.join(dirs.hermesRoot, 'backups', 'hermes-backup-1.zip'),
      path.join(dirs.hermesRoot, 'backups', 'anything.bin'),
      path.join(dirs.hermesRoot, 'BACKUPS', 'a.ZIP'),
      path.join(dirs.hermesRoot, 'profiles', 'coder', 'backups', 'b.zip'),
      path.join(dirs.hermesRoot, 'moved.tgz'),
      path.join(dirs.hermesRoot, 'profiles', 'coder', 'x.tar.gz'),
      path.join(dirs.home, 'hermes-backup-2026-10-19.zip'),
      path.join(dirs.workspace, 'innocent.zip'),
    ];
    const output = (raw: string) => { const check = guard.check(raw, 'backup-output'); return check.ok ? 'ok' : check.reason; };

    for (const archive of archives) expect([archive, every(archive)]).toEqual([archive, Array(4).fill('protected-path')]);
    // The folder itself is not moved, and neither is a folder that holds it.
    expect([guard.check(path.join(dirs.hermesRoot, 'backups'), 'relocate').ok, guard.check(path.join(dirs.hermesRoot, 'profiles'), 'relocate').ok]).toEqual([false, false]);
    // An ordinary zip outside Hermes's home is a file like any other.
    expect(every(path.join(dirs.home, 'Downloads.zip'))).toEqual(['ok', 'ok', 'ok', 'ok']);
    // The archives of a profile or board export (made for the owner to download) and the owner's profile import are not backups.
    expect(every(path.join(dirs.hermesRoot, 'profile-exports', 'coder.tar.gz'))).toEqual(['ok', 'ok', 'ok', 'ok']);
    expect(every(path.join(dirs.hermesRoot, 'kanban', 'board-exports', 'yard.tar.gz'))).toEqual(['ok', 'ok', 'ok', 'ok']);
    expect(every(path.join(dirs.hermesRoot, 'profile-imports', '1-coder.tar.gz'))).toEqual(['ok', 'ok', 'ok', 'ok']);
    expect([
      output(path.join(dirs.hermesRoot, 'backups', 'mine.zip')),
      output(path.join(dirs.hermesRoot, 'profiles', 'coder', 'backups', 'mine.zip')),
      output(path.join(dirs.home, 'mine.zip')),
      output(path.join(dirs.hermesRoot, 'mine.zip')),
      output(path.join(dirs.hermesRoot, 'backups', '..', '.env')),
    ]).toEqual(['ok', 'ok', 'protected-path', 'protected-path', 'protected-path']);
  });

  test('refuses a write, a delete or a move to the places that run code later, in a workspace and out of one, and lets everything beside them through', () => {
    const at = (...parts: string[]) => path.join(...parts);
    fs.mkdirSync(at(dirs.home, '.ssh'));
    fs.mkdirSync(at(dirs.workspace, '.git', 'hooks'), { recursive: true });
    fs.mkdirSync(at(dirs.home, '.config', 'app'), { recursive: true });
    fs.symlinkSync(at(dirs.home, '.ssh'), at(dirs.workspace, 'keys'));
    const guardWithConfigWorkspace = createFileGuard({ hermesRoot: dirs.hermesRoot, roots: [dirs.home], home: dirs.home, workspaces: () => [dirs.workspace, at(dirs.home, '.config', 'app')] });
    const verdicts = (raw: string, which: FileGuard = guard) => (['write', 'relocate'] as const).map((access) => { const check = which.check(raw, access); return check.ok ? 'ok' : check.reason; });
    const persistent = [
      at(dirs.home, '.zshrc'),
      at(dirs.home, '.zprofile'),
      at(dirs.home, '.zshenv'),
      at(dirs.home, '.zlogin'),
      at(dirs.home, '.bashrc'),
      at(dirs.home, '.bash_profile'),
      at(dirs.home, '.profile'),
      at(dirs.home, '.ZSHRC'),
      at(dirs.home, '.ssh'),
      at(dirs.home, '.ssh', 'authorized_keys'),
      at(dirs.home, 'Library', 'LaunchAgents', 'x.plist'),
      at(dirs.home, 'Library', 'LaunchDaemons'),
      at(dirs.workspace, '.git', 'hooks', 'pre-commit'),
      at(dirs.workspace, '.git', 'config'),
      at(dirs.home, 'work', 'other', '.git', 'hooks', 'post-checkout'),
      at(dirs.home, '.config', 'fish', 'config.fish'),
      at(dirs.hermesRoot, 'hooks', 'x'),
      at(dirs.hermesRoot, 'scripts', 'job.sh'),
      at(dirs.hermesRoot, 'skills', 'a', 'SKILL.md'),
      at(dirs.hermesRoot, 'plugins', 'p', '__init__.py'),
      at(dirs.hermesRoot, 'profiles', 'coder', 'scripts', 'job.sh'),
      at(dirs.hermesRoot, 'profiles', 'coder', 'skills'),
      // A link to one of them is the place it leads to.
      at(dirs.workspace, 'keys', 'authorized_keys'),
      '~/.zshrc',
      `${dirs.home}/work/../.zshrc`,
    ];

    for (const raw of persistent) expect([raw, verdicts(raw)]).toEqual([raw, ['persistence-path', 'persistence-path']]);
    expect([
      verdicts(at(dirs.home, 'notes.md')),
      verdicts(at(dirs.home, '.gitignore')),
      verdicts(at(dirs.workspace, '.git', 'HEAD')),
      verdicts(at(dirs.workspace, '.gitignore')),
      verdicts(at(dirs.home, 'Library', 'Preferences', 'x.plist')),
      verdicts(at(dirs.hermesRoot, 'memories', 'MEMORY.md')),
      verdicts(at(dirs.hermesRoot, 'profiles', 'coder', 'AGENTS.md')),
      verdicts(at(dirs.hermesRoot, 'skillsets', 'x')),
      // `~/.config` is out of bounds except inside a workspace that sits there.
      verdicts(at(dirs.home, '.config', 'app', 'settings.json'), guardWithConfigWorkspace),
    ]).toEqual(Array(9).fill(['ok', 'ok']));
    expect(verdicts(at(dirs.home, '.config', 'fish', 'config.fish'), guardWithConfigWorkspace)).toEqual(['persistence-path', 'persistence-path']);
    // Reading is another matter (it has its own rules).
    expect(guard.check(at(dirs.home, '.zshrc'), 'browse').ok).toBe(true);
  });

  test('refuses to read or list keys and credentials: SSH, cloud, browser profiles, Keychains, the vault and Hermes’s credential files, and what links to them; ordinary files and projects stay readable', () => {
    const at = (...parts: string[]) => path.join(...parts);
    fs.mkdirSync(at(dirs.home, '.ssh'));
    fs.symlinkSync(at(dirs.home, '.ssh'), at(dirs.workspace, 'keys'));
    const verdicts = (raw: string) => (['read', 'browse', 'write'] as const).map((access) => { const check = guard.check(raw, access); return check.ok ? 'ok' : check.reason; });
    const secret = [
      at(dirs.home, '.ssh', 'id_ed25519'),
      at(dirs.home, '.ssh'),
      at(dirs.home, '.aws', 'credentials'),
      at(dirs.home, '.gnupg', 'private-keys-v1.d', 'k.key'),
      at(dirs.home, '.config', 'gh', 'hosts.yml'),
      at(dirs.home, 'Library', 'Keychains', 'login.keychain-db'),
      at(dirs.home, 'Library', 'Application Support', 'Google', 'Chrome', 'Default', 'Cookies'),
      at(dirs.home, 'Library', 'Application Support', 'Firefox', 'Profiles', 'x', 'logins.json'),
      at(dirs.home, 'Library', 'Safari', 'History.db'),
      at(dirs.home, '.netrc'),
      at(dirs.workspace, 'deploy_id_rsa'.replace('deploy_', '')),
      at(dirs.hermesRoot, 'vault.key'),
      at(dirs.hermesRoot, 'vault.json.enc'),
      at(dirs.hermesRoot, 'profiles', 'coder', 'vault.key'),
      at(dirs.hermesRoot, 'config.yaml'),
      at(dirs.hermesRoot, 'profiles', 'coder', 'config.yaml'),
      at(dirs.hermesRoot, 'mcp-tokens', 'server.json'),
      at(dirs.hermesRoot, 'pairing', 'x.json'),
      at(dirs.hermesRoot, '.anthropic_oauth.json'),
      at(dirs.workspace, 'keys', 'id_ed25519'),
      '~/.ssh/id_rsa',
    ];
    for (const raw of secret) expect([raw, verdicts(raw)[0], verdicts(raw)[1]]).toEqual([raw, 'secret-path', 'secret-path']);
    expect([
      verdicts(at(dirs.home, 'notes.md'))[0],
      verdicts(at(dirs.home, '.ssh_notes.md'))[0],
      verdicts(at(dirs.workspace, 'src', 'main.ts'))[0],
      verdicts(at(dirs.hermesRoot, 'profiles', 'coder', 'AGENTS.md'))[0],
      verdicts(at(dirs.hermesRoot, 'skills', 'a', 'SKILL.md'))[0],
      verdicts(at(dirs.hermesRoot, 'memories', 'MEMORY.md'))[0],
      verdicts(at(dirs.home, 'Library', 'Preferences', 'x.plist'))[0],
      verdicts(at(dirs.outside, 'x.txt'))[0],
      verdicts(at(dirs.home, '.config', 'app', 'settings.json'))[0],
    ]).toEqual(Array(9).fill('ok'));
  });
});
