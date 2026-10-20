// A Caduceus deployment for tests of its own update (M5 #12): a git checkout that follows a "remote" repository, both on this machine, so that an update
// is a real `git pull --ff-only` and nothing reaches the network, and the owner's checkout is never touched. `publish` commits to the remote, which gives
// the checkout something to update to. The install and build commands are tiny node programs, so no test runs `npm`.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Deployment } from '../../src/self-update.ts';

const IDENTITY = { GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };

export interface DeploymentRepo {
  /** What `startCaduceusServer` takes as `deployment`. */
  deployment: Deployment;
  /** The checkout. */
  root: string;
  /** Commits `files` (path → text) to the remote's branch, as someone else pushing a new version. */
  publish(message: string, files: Record<string, string>): void;
  /** The commit the checkout is at now. */
  head(): string;
  /** Leaves a change in the checkout that is not committed. */
  dirty(): void;
  /** What the build and install commands have been run for, in order (`build`, `install`). */
  ran(): string[];
  remove(): void;
}

export function createDeploymentRepo(): DeploymentRepo {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-deployment-'));
  const remote = path.join(base, 'remote.git');
  const author = path.join(base, 'author');
  const root = path.join(base, 'deployment');
  const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...IDENTITY } });
  fs.mkdirSync(remote);
  git(remote, 'init', '-q', '--bare', '-b', 'main');
  fs.mkdirSync(author);
  git(author, 'init', '-q', '-b', 'main');
  git(author, 'remote', 'add', 'origin', remote);
  fs.writeFileSync(path.join(author, 'package.json'), JSON.stringify({ name: 'caduceus-fixture', version: '1.0.0' }));
  fs.writeFileSync(path.join(author, 'package-lock.json'), '{}');
  git(author, 'add', '.');
  git(author, 'commit', '-q', '-m', 'first');
  git(author, 'push', '-q', 'origin', 'HEAD:main');
  git(base, 'clone', '-q', remote, root);
  const record = path.join(base, 'ran.log');
  const step = (name: string) => ['node', '-e', `require('node:fs').appendFileSync(${JSON.stringify(record)}, ${JSON.stringify(`${name}\n`)}); console.log(${JSON.stringify(`${name} ran`)})`];
  return {
    root,
    deployment: { root, install: step('install'), build: step('build') },
    publish(message, files) {
      for (const [file, text] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(author, file)), { recursive: true });
        fs.writeFileSync(path.join(author, file), text);
      }
      git(author, 'add', '.');
      git(author, 'commit', '-q', '-m', message);
      git(author, 'push', '-q', 'origin', 'HEAD:main');
    },
    head: () => git(root, 'rev-parse', '--short=12', 'HEAD').trim(),
    dirty: () => fs.appendFileSync(path.join(root, 'package.json'), '\n'),
    ran: () => (fs.existsSync(record) ? fs.readFileSync(record, 'utf8').split('\n').filter(Boolean) : []),
    remove: () => fs.rmSync(base, { recursive: true, force: true }),
  };
}
