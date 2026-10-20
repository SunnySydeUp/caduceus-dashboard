import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { ownerCookie } from './fixtures/owner.ts';

// The Inbox's cron source against the real Hermes: a script job that exits non-zero is a failed job, and the Inbox says so.
let hermes: TestHermes;
let server: CaduceusServer | undefined;
beforeAll(async () => {
  hermes = await launchTestHermes();
  await hermes.backend.ready();
}, 90_000);
afterAll(async () => {
  await hermes.stop();
});
afterEach(async () => {
  await server?.close();
  server = undefined;
});

const json = { 'content-type': 'application/json' };

test('a script job that exits non-zero shows in the Inbox as failed, with what the script said', async () => {
  const scripts = path.join(hermes.home, 'scripts');
  fs.mkdirSync(scripts, { recursive: true });
  fs.writeFileSync(path.join(scripts, 'boom.sh'), '#!/bin/sh\necho "disk is full" >&2\nexit 3\n', { mode: 0o755 });
  const made = await hermes.backend.fetch('/api/cron/jobs?profile=default', { method: 'POST', headers: json, body: JSON.stringify({ name: 'Boom', schedule: '0 3 * * *', script: 'boom.sh', no_agent: true, deliver: 'local' }) });
  expect(made.status, await made.clone().text()).toBe(200);
  const { id } = (await made.json()) as { id: string };
  // The page is already open and Hermes's own change event is the only thing that can tell it before the next slow poll.
  server = await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home, hermesInstallDir: hermes.install.dir, inboxReadMs: 120_000 });
  const cookie = await ownerCookie(server.url);
  const items = async () => ((await (await fetch(`${server!.url}/_caduceus/api/inbox`, { headers: { cookie } })).json()) as { items: { id: string; title: string; detail: string }[] }).items;
  await new Promise((resolve) => setTimeout(resolve, 6000));
  // A throwaway Hermes runs no gateway, so Health's own notice about that is in the Inbox too: what matters here is that no job has failed yet.
  expect((await items()).filter((item) => item.id.startsWith('cron-failed'))).toEqual([]);
  const ran = await hermes.backend.fetch(`/api/cron/jobs/${id}/trigger?profile=default`, { method: 'POST' });
  expect(ran.status).toBe(200);
  await expect.poll(async () => (await items()).map((item) => item.id), { timeout: 10_000 }).toContain(`cron-failed:default:${id}`);
  expect((await items()).find((item) => item.id.startsWith('cron-failed'))).toMatchObject({ title: '“Boom” failed', detail: expect.stringContaining('disk is full') });
});
