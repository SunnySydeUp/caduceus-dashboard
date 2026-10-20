import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from 'vitest';
import { SLASH_ALIASES } from '@caduceus/contracts/policy/gateway';
import { findHermesInstall } from '../src/hermes-contract.ts';
import { linkSharedInstalls } from './fixtures/hermes-installs.ts';
import { hermesPython } from './fixtures/seed-session.ts';

// The policy judges an alias as the command it names. Hermes's registry is the only source of what the aliases are, so
// this reads it from the installed Hermes (a throwaway HERMES_HOME; nothing of the owner's is read or written).
test('SLASH_ALIASES is exactly the alias table of the installed Hermes command registry', async () => {
  const install = await findHermesInstall('hermes');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-slash-aliases-'));
  try {
    await linkSharedInstalls(home);
    const { stdout } = await promisify(execFile)(
      hermesPython(),
      ['-c', 'import json; from hermes_cli.commands import COMMAND_REGISTRY as R; print(json.dumps({a: c.name for c in R for a in c.aliases}))'],
      { cwd: install.dir, env: { ...process.env, HERMES_HOME: home } },
    );
    expect(SLASH_ALIASES).toEqual(JSON.parse(stdout));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}, 30_000);
