// A Hermes plugin that lives in a git repository on this machine, for tests of System › Plugins that run Hermes's real install and update and never
// reach the network. Hermes installs from any git URL, `file://` included, and updates a git install with `git pull`, so a test installs from
// this repository and then commits to it to give the install something to update to. `OFFLINE_ENV` keeps Hermes (its catalogue fetch) and git
// off the internet, and keeps git from reading the owner's `~/.gitconfig` (a URL rewrite, a credential helper).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Environment that keeps Hermes and git off the internet: every proxy refuses at once, and git reads no config of the owner's. */
export const OFFLINE_ENV: Record<string, string> = {
  HTTP_PROXY: 'http://127.0.0.1:1',
  HTTPS_PROXY: 'http://127.0.0.1:1',
  ALL_PROXY: 'http://127.0.0.1:1',
  NO_PROXY: '127.0.0.1,localhost',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_TERMINAL_PROMPT: '0',
};

export interface PluginManifest {
  /** The name Hermes lists the plugin under. */
  name: string;
  version?: string;
  description?: string;
  /** Environment variables the plugin asks for; Hermes names them after the install. */
  requiresEnv?: string[];
}

export interface PluginRepo {
  /** The address to install from. */
  url: string;
  dir: string;
  /** Commits a change to a file of the plugin: the next update of an install brings it in. */
  commit(file: string, text: string, message?: string): void;
  remove(): void;
}

const IDENTITY = { GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' };

export function createPluginRepo(manifest: PluginManifest): PluginRepo {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-plugin-repo-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: { ...process.env, ...IDENTITY, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } });
  git('init', '-q', '-b', 'main');
  const lines = [`name: ${manifest.name}`, `version: ${manifest.version ?? '1.0.0'}`, `description: ${manifest.description ?? 'A plugin made for a test.'}`];
  if (manifest.requiresEnv?.length) lines.push('requires_env:', ...manifest.requiresEnv.map((name) => `  - ${name}`));
  fs.writeFileSync(path.join(dir, 'plugin.yaml'), `${lines.join('\n')}\n`);
  fs.writeFileSync(path.join(dir, '__init__.py'), 'def register(ctx):\n    pass\n');
  git('add', '.');
  git('commit', '-q', '-m', 'first');
  return {
    url: `file://${dir}`,
    dir,
    commit(file, text, message = `change ${file}`) {
      fs.writeFileSync(path.join(dir, file), text);
      git('add', '.');
      git('commit', '-q', '-m', message);
    },
    remove: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}
