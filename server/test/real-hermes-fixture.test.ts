import fs from 'node:fs';
import os from 'node:os';
import { describe, expect, test } from 'vitest';
import { endLaunches, launchTestHermes } from './fixtures/real-hermes.ts';

// The fixture's own promise: a launch that nobody holds the handle of removes what it made. A hook that times out before `launchTestHermes` returns leaves such a launch; the run
// then fails with "Tests left temp directories behind" on top of the real failure. The directories are named after this file, so no other test's are counted.
const mine = () => fs.readdirSync(os.tmpdir()).filter((name) => /^caduceus-(hermes-)?home-real-hermes-fixture-/.test(name));

describe('a launch nobody holds', () => {
  test('removes its home and its HOME when it fails', async () => {
    await expect(launchTestHermes({ env: { PATH: '' } })).rejects.toThrow();
    expect(mine()).toEqual([]);
  });

  test('removes its home and its HOME when the file it belongs to ends before it has returned', async () => {
    const launching = launchTestHermes();
    await endLaunches();
    await expect(launching).rejects.toThrow('no longer wanted');
    expect(mine()).toEqual([]);
  });

  test('ending the file stops a Hermes that a hook launched and never stopped', async () => {
    const hermes = await launchTestHermes();
    await endLaunches();
    expect(fs.existsSync(hermes.home)).toBe(false);
    expect(mine()).toEqual([]);
  });
});
