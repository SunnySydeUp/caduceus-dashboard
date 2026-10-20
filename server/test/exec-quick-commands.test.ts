import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { execQuickCommandNames } from '../src/exec-quick-commands.ts';
import { launchFakeHermes } from './fixtures/fake-hermes.ts';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';

// Which slash commands run a shell command is in Hermes's own config (`quick_commands` with `type: exec`), per profile.
// This reads it from a real Hermes in a throwaway HERMES_HOME, seeded through Hermes's own API.
let hermes: TestHermes;
beforeAll(async () => {
  hermes = await launchTestHermes();
  await hermes.backend.ready();
}, 60_000);
afterAll(async () => {
  await hermes.stop();
});

const json = { 'content-type': 'application/json' };

describe('exec-type quick commands', () => {
  test('are the exec ones of every profile, by lower-case name; aliases and other profiles’ commands are not mixed up', async () => {
    const put = (route: string, yaml_text: string) => hermes.backend.fetch(route, { method: 'PUT', headers: json, body: JSON.stringify({ yaml_text }) });
    await hermes.backend.fetch('/api/profiles', { method: 'POST', headers: json, body: JSON.stringify({ name: 'coder' }) });
    await put('/api/config/raw', 'quick_commands:\n  Deploy:\n    type: exec\n    command: echo deploying\n  hello:\n    type: alias\n    target: /status\n');
    await put('/api/config/raw?profile=coder', 'quick_commands:\n  disk-usage:\n    type: exec\n    command: df -h\n');

    const names = await execQuickCommandNames(hermes.backend);

    expect([...names].sort()).toEqual(['deploy', 'disk-usage']);
  });

  test('cannot be read when Hermes does not answer, and that is an error, not an empty list', async () => {
    // The stand-in Hermes has profiles but no config route: a lookup that fails must not look like "no exec commands".
    const fake = launchFakeHermes();
    try {
      await fake.ready();
      await expect(execQuickCommandNames(fake)).rejects.toThrow(/config/);
    } finally {
      await fake.stop();
    }
  });
});
