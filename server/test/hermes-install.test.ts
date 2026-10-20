import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { findHermesInstall } from '../src/hermes-contract.ts';

// What `hermes --version` says, in the two shapes Hermes has printed it in. A stand-in `hermes` prints the banner: the parsing is Caduceus's, not Hermes's.
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function standIn(banner: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-install-'));
  dirs.push(dir);
  const file = path.join(dir, 'hermes');
  fs.writeFileSync(file, `#!/bin/sh\ncat <<'E'\n${banner}\nInstall directory: /opt/hermes-agent\nInstall method: git\nE\n`, { mode: 0o755 });
  return file;
}

describe('reading the installed Hermes from its banner', () => {
  test('a release with an upstream commit', async () => {
    const install = await findHermesInstall(standIn('Hermes Agent v0.21.4 (2026.9.21) · upstream 2e1afdf0'));
    expect(install).toEqual({ version: '0.21.4', releaseDate: '2026.9.21', upstreamCommit: '2e1afdf0', dir: '/opt/hermes-agent' });
  });

  test('a build after a release names the release, the way Hermes’s own API does, so the pin and the running Hermes read as the same version', async () => {
    const install = await findHermesInstall(standIn('Hermes Agent v0.22.2+1979.g5fc490e (2026.9.24) · stable · local 5fc490e2b341'));
    expect(install).toEqual({ version: '0.22.2', releaseDate: '2026.9.24', upstreamCommit: null, dir: '/opt/hermes-agent' });
  });
});
