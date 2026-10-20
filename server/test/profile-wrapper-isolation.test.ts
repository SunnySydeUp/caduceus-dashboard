import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';

let hermes: TestHermes;
const realWrapper = path.join(os.userInfo().homedir, '.local', 'bin', 'cdtest-isolation-probe');

beforeAll(async () => {
  hermes = await launchTestHermes();
});
afterAll(async () => {
  await hermes.stop();
});

test('creating a profile writes its alias wrapper under the temp HOME, never the real ~/.local/bin', async () => {
  expect(fs.existsSync(realWrapper)).toBe(false);
  await hermes.cli('profile', 'create', 'cdtest-isolation-probe');
  expect(fs.existsSync(path.join(hermes.fakeHome, '.local', 'bin', 'cdtest-isolation-probe'))).toBe(true);
  expect(fs.existsSync(realWrapper)).toBe(false);
});
