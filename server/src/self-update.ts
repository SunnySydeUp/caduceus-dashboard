// Updating Caduceus's own deployment (M5 #12; architecture §8): the checkout it runs from is a git clone, so an update is the same three steps a person
// would take (fast-forward to the upstream branch, install what the lockfile changed, build the web app), and what runs only changes when the server
// restarts. Every command is a fixed list of arguments with no shell, run in the checkout, and its output goes to the owner's live log line by line.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { UpdateCheck, UpdateCommit } from '@caduceus/contracts/caduceus-api';
import { isRecord } from '@caduceus/contracts/policy/guards';

/** Where Caduceus is deployed and how it is made again after a pull. The commands default to the project's own; a test names others. */
export interface Deployment {
  /** The git checkout Caduceus runs from. */
  root: string;
  /** Run when the lockfile or `package.json` changed in the pull. */
  install?: readonly string[];
  /** Run after every pull: builds the web app. */
  build?: readonly string[];
}

const DEFAULT_INSTALL = ['npm', 'install', '--no-audit', '--no-fund'] as const;
const DEFAULT_BUILD = ['npm', 'run', 'build', '-w', 'web'] as const;
/** The most commits listed for one update. */
const MAX_COMMITS = 50;
/** How long one command may run before Caduceus stops waiting (an install can be slow). */
const STEP_TIMEOUT_MS = 20 * 60_000;
/** Git must never ask a question: there is nobody at the keyboard of the Mac that runs the service. */
const GIT_ENV = { GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'echo', NO_COLOR: '1' } as const;

interface Ran {
  code: number;
  stdout: string;
}

function run(command: readonly string[], cwd: string, onOutput?: (text: string) => void): Promise<Ran> {
  const [program, ...args] = command;
  const child = spawn(program, args, { cwd, env: { ...process.env, ...GIT_ENV }, stdio: ['ignore', 'pipe', 'pipe'], signal: AbortSignal.timeout(STEP_TIMEOUT_MS) });
  let stdout = '';
  child.stdout.on('data', (chunk: Buffer) => {
    stdout += chunk.toString('utf8');
    onOutput?.(chunk.toString('utf8'));
  });
  child.stderr.on('data', (chunk: Buffer) => onOutput?.(chunk.toString('utf8')));
  const { promise, resolve } = Promise.withResolvers<Ran>();
  child.once('error', () => resolve({ code: 127, stdout }));
  child.once('close', (code) => resolve({ code: code ?? 1, stdout }));
  return promise;
}

const git = (root: string, args: readonly string[], onOutput?: (text: string) => void) => run(['git', ...args], root, onOutput);

/** `sha<TAB>summary<TAB>author<TAB>date` per line, as `--format` prints them. */
function commitsOf(text: string): UpdateCommit[] {
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [sha = '', summary = '', author = '', at = ''] = line.split('\t');
      return { sha: sha.slice(0, 12), summary, author, at };
    });
}

const LOG_FORMAT = '--format=%H%x09%s%x09%an%x09%aI';

/** How one update went: what it changed. */
export interface SelfUpdateResult {
  ok: boolean;
  message: string;
  fromVersion: string | null;
  toVersion: string | null;
  changes: UpdateCommit[];
}

export interface SelfUpdate {
  /** What `git` says about the checkout: its version, whether the upstream branch has more, and what. Asks the remote, so it is cached unless `force`. */
  check(force: boolean): Promise<UpdateCheck>;
  /** The version running from the checkout now: the package's version and the commit. */
  version(): Promise<string>;
  /** Pulls, installs and builds, printing what each step says through `log`. Never throws: a step that fails is the result. */
  update(log: (text: string) => void): Promise<SelfUpdateResult>;
}

const CHECK_CACHE_MS = 10 * 60_000;

export function createSelfUpdate(deployment: Deployment, now: () => number): SelfUpdate {
  const { root } = deployment;
  let cached: { at: number; check: UpdateCheck } | undefined;

  const packageVersion = (): string => {
    try {
      const manifest: unknown = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
      return isRecord(manifest) && typeof manifest.version === 'string' ? manifest.version : '0.0.0';
    } catch {
      return '0.0.0';
    }
  };
  const head = async () => (await git(root, ['rev-parse', '--short=12', 'HEAD'])).stdout.trim() || null;
  const version = async () => {
    const sha = await head();
    return sha ? `${packageVersion()} (${sha})` : packageVersion();
  };

  const check = async (): Promise<UpdateCheck> => {
    const current_version = await version();
    const base = { current_version, install_method: 'git', update_command: 'git pull --ff-only' } as const;
    if ((await git(root, ['rev-parse', '--is-inside-work-tree'])).code !== 0) return { ...base, behind: null, update_available: false, can_apply: false, message: 'Caduceus is not running from a git checkout here, so it cannot update itself.' };
    if ((await git(root, ['rev-parse', '--abbrev-ref', '@{upstream}'])).code !== 0) return { ...base, behind: null, update_available: false, can_apply: false, message: 'This copy of Caduceus follows no upstream branch, so there is nothing to compare it with.' };
    // `fetch` asks the remote and changes nothing in the working tree.
    if ((await git(root, ['fetch', '--quiet'])).code !== 0) return { ...base, behind: null, update_available: false, can_apply: false, message: "Couldn't reach the update source — try again later." };
    const behind = Number((await git(root, ['rev-list', '--count', 'HEAD..@{upstream}'])).stdout.trim());
    if (!Number.isFinite(behind)) return { ...base, behind: null, update_available: false, can_apply: false, message: 'Caduceus could not count what is new.' };
    if (behind === 0) return { ...base, behind: 0, update_available: false, can_apply: true, message: "You're on the latest version." };
    const commits = commitsOf((await git(root, ['log', LOG_FORMAT, `--max-count=${MAX_COMMITS}`, 'HEAD..@{upstream}'])).stdout);
    const dirty = (await git(root, ['status', '--porcelain', '--untracked-files=no'])).stdout.trim() !== '';
    return {
      ...base,
      behind,
      update_available: true,
      can_apply: !dirty,
      message: dirty ? 'This copy of Caduceus has changes that are not committed, so an update could not fast-forward it. Commit or discard them first.' : null,
      commits,
    };
  };

  return {
    version,
    async check(force) {
      if (!force && cached && now() - cached.at < CHECK_CACHE_MS) return cached.check;
      const fresh = await check();
      cached = { at: now(), check: fresh };
      return fresh;
    },
    async update(log) {
      cached = undefined;
      const fromSha = await head();
      const fromVersion = await version();
      const fail = (message: string): SelfUpdateResult => ({ ok: false, message, fromVersion, toVersion: null, changes: [] });
      const step = async (label: string, command: readonly string[]) => {
        log(`$ ${label}\n`);
        return run(command, root, log);
      };
      if ((await git(root, ['status', '--porcelain', '--untracked-files=no'])).stdout.trim() !== '') return fail('This copy of Caduceus has changes that are not committed, so it was not updated.');
      if ((await step('git pull --ff-only', ['git', 'pull', '--ff-only'])).code !== 0) return fail('Git could not fast-forward Caduceus to its upstream branch. Nothing was changed.');
      const toSha = await head();
      const toVersion = await version();
      const changes = fromSha && toSha ? commitsOf((await git(root, ['log', LOG_FORMAT, `--max-count=${MAX_COMMITS}`, `${fromSha}..${toSha}`])).stdout) : [];
      const packagesChanged = fromSha && toSha ? (await git(root, ['diff', '--name-only', fromSha, toSha, '--', 'package.json', 'package-lock.json', '*/package.json'])).stdout.trim() !== '' : false;
      const partial = (what: string): SelfUpdateResult => ({ ok: false, message: `${what} The new code is pulled but is not in use: Caduceus has not restarted.`, fromVersion, toVersion, changes });
      if (packagesChanged && (await step((deployment.install ?? DEFAULT_INSTALL).join(' '), deployment.install ?? DEFAULT_INSTALL)).code !== 0) return partial('Installing what the new version needs failed.');
      if ((await step((deployment.build ?? DEFAULT_BUILD).join(' '), deployment.build ?? DEFAULT_BUILD)).code !== 0) return partial('Building the web app failed.');
      return { ok: true, message: 'Caduceus is updated and restarts to use it.', fromVersion, toVersion, changes };
    },
  };
}
