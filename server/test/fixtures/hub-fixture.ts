// A skills hub that lives on this machine, for tests of Agents › Skills › Hub that run Hermes's real code and never reach the internet.
//
// Hermes reads its hub from places a test can fill:
//   - the `official` source scans an `optional-skills` directory (`HERMES_OPTIONAL_SKILLS`), and installs from it;
//   - the `hermes-index` source reads a cached JSON catalogue in the profile's `skills/.hub/index-cache` for six hours before it asks the network.
// Every other source needs the network, so `offlineEnv` points Hermes's HTTP clients at a proxy that refuses at once and `search`
// asks only for the sources that are local. Nothing is installed from anywhere but the directory made here.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** One skill of the fixture's `optional-skills` directory: `category/name/SKILL.md`. */
export interface FixtureSkill {
  category: string;
  name: string;
  description: string;
  body?: string;
  /** Extra files beside SKILL.md, by their place in the skill's folder. */
  files?: Record<string, string>;
  tags?: string[];
}

export const skillText = ({ name, description, body, tags }: FixtureSkill) =>
  `---\nname: ${name}\ndescription: ${description}\n${tags ? `metadata:\n  hermes:\n    tags: [${tags.join(', ')}]\n` : ''}---\n\n# ${name}\n\n${body ?? 'Steps go here.\n'}`;

export interface HubFixture {
  /** The `HERMES_OPTIONAL_SKILLS` directory. */
  optionalDir: string;
  /** Environment that keeps Hermes off the internet and on this fixture. */
  env: Record<string, string>;
  /** Writes (or rewrites) a skill of the official source. */
  put(skill: FixtureSkill): void;
  /** Gives a profile's home the catalogue its `hermes-index` source reads; `fresh` keeps it from being fetched again. */
  seedIndex(profileHome: string, entries: IndexEntry[]): void;
  remove(): void;
}

export interface IndexEntry {
  name: string;
  description: string;
  source: string;
  identifier: string;
  trust_level: 'builtin' | 'trusted' | 'community';
  tags?: string[];
  repo?: string;
  path?: string;
}

/** Requests to anything but this machine fail at once: a refused connection, not a wait for a time-out. */
const OFFLINE = { HTTP_PROXY: 'http://127.0.0.1:1', HTTPS_PROXY: 'http://127.0.0.1:1', ALL_PROXY: 'http://127.0.0.1:1', NO_PROXY: '127.0.0.1,localhost' };

export function createHubFixture(): HubFixture {
  const optionalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-hub-fixture-'));
  return {
    optionalDir,
    env: { HERMES_OPTIONAL_SKILLS: optionalDir, ...OFFLINE },
    put(skill) {
      const folder = path.join(optionalDir, skill.category, skill.name);
      fs.rmSync(folder, { recursive: true, force: true });
      fs.mkdirSync(folder, { recursive: true });
      fs.writeFileSync(path.join(folder, 'SKILL.md'), skillText(skill));
      for (const [file, content] of Object.entries(skill.files ?? {})) {
        fs.mkdirSync(path.dirname(path.join(folder, file)), { recursive: true });
        fs.writeFileSync(path.join(folder, file), content);
      }
    },
    seedIndex(profileHome, entries) {
      const dir = path.join(profileHome, 'skills', '.hub', 'index-cache');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'hermes-index.json'), JSON.stringify({ version: 1, skills: entries }));
    },
    remove() {
      fs.rmSync(optionalDir, { recursive: true, force: true });
    },
  };
}
