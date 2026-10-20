import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseCatalogue } from '../../web/src/modules/models/model-catalogue.ts';
import { activateRequest, deleteRequest, downloadBrowsedRequest, ejectRequest, explainRuntime, freedMessage, LOCAL_PROVIDER, filesPath, jobsPath, parseCatalog, parseJobs, parseHardware, parseRepoFiles, parseSearch, parseStatus, searchPath, serverRequest, sideloadRequest, statusPaths } from '../../web/src/modules/models/local-models.ts';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { fixtureBytes, startHuggingFaceFixture, type HuggingFaceFixture } from './fixtures/huggingface-fixture.ts';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { ownerCookie } from './fixtures/owner.ts';

// Agents › Models › Local models (M4 #14) through the Caduceus server, in front of the real Hermes in a throwaway HERMES_HOME. Hermes reaches
// Hugging Face only through the fixture (`fixtures/huggingface-fixture.ts`): every download here is a few kilobytes of a local file, no
// model is ever fetched from the internet, and no model is ever loaded (the runtime is not installed in a test home).
let hermes: TestHermes;
let hub: HuggingFaceFixture;
let server: CaduceusServer | undefined;
beforeAll(async () => {
  hub = await startHuggingFaceFixture({
    'fixture/tiny-GGUF': { files: [{ path: 'tiny-Q4_K_M.gguf', bytes: 64 * 1024 }, { path: 'tiny-Q8_0.gguf', bytes: 128 * 1024 }, { path: 'README.md', bytes: 10 }], downloads: 1200, likes: 7 },
    'fixture/other-GGUF': { files: [{ path: 'other-Q4_K_M.gguf', bytes: 32 * 1024 }], downloads: 30, likes: 1 },
  });
  hermes = await launchTestHermes({ env: hub.env });
  await hermes.backend.ready();
}, 90_000);
afterAll(async () => {
  await hermes.stop();
  await hub.close();
});
afterEach(async () => {
  await server?.close();
  server = undefined;
  fs.rmSync(path.join(hermes.home, 'caduceus'), { recursive: true, force: true });
});

interface Owner {
  call<T = unknown>(method: string, route: string, init?: { body?: unknown; headers?: Record<string, string> }): Promise<{ status: number; body: T }>;
}

async function start(): Promise<Owner> {
  server = await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home });
  const { url } = server;
  const cookie = await ownerCookie(url);
  const call: Owner['call'] = async (method, route, { body, headers } = {}) => {
    const res = await fetch(`${url}${route}`, { method, headers: { origin: url, cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, body: (text.startsWith('{') ? JSON.parse(text) : text) as never };
  };
  return { call };
}

describe('status and hardware', () => {
  test('say plainly that the runtime is not installed, with this machine\'s memory, and no model is claimed', async () => {
    const owner = await start();
    const [status, hardware] = await Promise.all(statusPaths.map(async (route) => (await owner.call('GET', route)).body));
    const view = parseStatus(status);
    expect(view.runtime).toMatchObject({ installed: false, backend: undefined, serverRunning: false });
    expect(view.models).toEqual([]);
    expect(view.active).toBeUndefined();
    expect(view.modelsDir).toBe(path.join(hermes.home, 'models'));
    expect(explainRuntime(view)).toBe('The local runtime is not installed on this Mac. Hermes runs local models with llama.cpp, which it downloads once (a few hundred megabytes) and keeps up to date. Until it is installed, a downloaded model cannot be started.');

    const memory = parseHardware(hardware);
    // The machine under test is a Mac with unified memory: its own figures, as Hermes words them.
    expect(memory.totalMemoryLabel).toMatch(/^\d+(\.\d)? GB$/);
    expect(memory.unified).toBe(os.arch() === 'arm64');
    expect(memory.ramTotalBytes).toBe(os.totalmem());
  });
});

describe('the catalogue', () => {
  test('lists every model Hermes ships, each priced for this machine before anything is downloaded: size, whether it fits and how it would run', async () => {
    const owner = await start();
    const rows = parseCatalog((await owner.call('GET', '/api/local-models/catalog')).body);
    // Hermes's catalog grows with its releases: the expectation is the ids of Hermes's own answer, in its order, read without the page's code.
    const hermesRows = ((await (await hermes.backend.fetch('/api/local-models/catalog')).json()) as { models: { id: string }[] }).models;
    expect(hermesRows.length).toBeGreaterThan(0);
    expect(rows.map((row) => row.id)).toEqual(hermesRows.map((row) => row.id));
    for (const row of rows) {
      expect(row.name).not.toBe('');
      expect(row.sizeBytes).toBeGreaterThan(0);
      expect(row.sizeLabel).toMatch(/^\d+\.\d GB$/);
      expect(row.fitSummary).not.toBe('');
      expect(row.downloaded).toBe(false);
    }
    expect(rows.filter((row) => row.recommended).length).toBeLessThanOrEqual(1);
    // A model this Mac cannot hold says so in Hermes's words, and is not hidden.
    for (const row of rows.filter((candidate) => !candidate.fits)) expect(row.fitSummary).toBe('Needs more memory than this machine has');
    expect(rows.find((row) => row.id === 'qwen3.8-27b')).toMatchObject({ vision: true, nativeContext: '256K' });
    // Nothing but the fixture was asked for: no real address was reached.
    expect(hub.fetched).toEqual([]);
  });
});

describe('searching Hugging Face', () => {
  test('finds GGUF repos by name, most downloaded first, and lists a repo\'s files with their size and a verdict for this machine', async () => {
    const owner = await start();
    const hits = parseSearch((await owner.call('GET', searchPath('GGUF'))).body);
    expect(hits).toEqual([
      { repo: 'fixture/tiny-GGUF', downloads: 1200, likes: 7, updated: '2026-10-01', gated: false },
      { repo: 'fixture/other-GGUF', downloads: 30, likes: 1, updated: '2026-10-01', gated: false },
    ].sort((a, b) => b.downloads - a.downloads));
    expect(parseSearch((await owner.call('GET', searchPath('tiny'))).body).map((hit) => hit.repo)).toEqual(['fixture/tiny-GGUF']);
    expect(parseSearch((await owner.call('GET', searchPath('   '))).body)).toEqual([]);

    const files = parseRepoFiles((await owner.call('GET', filesPath('fixture/tiny-GGUF'))).body);
    // Largest first; the README is not a model. A few kilobytes fit any Mac.
    expect(files).toEqual([
      { label: 'Q8_0', paths: ['tiny-Q8_0.gguf'], sizeBytes: 128 * 1024, sizeLabel: '128 KB', fit: 'fits-gpu' },
      { label: 'Q4_K_M', paths: ['tiny-Q4_K_M.gguf'], sizeBytes: 64 * 1024, sizeLabel: '64 KB', fit: 'fits-gpu' },
    ]);
    // A repo Hugging Face does not have is Hermes's plain error, not a crash.
    expect((await owner.call('GET', filesPath('fixture/missing'))).status).toBe(502);
  });
});

describe('a download', () => {
  const jobsOf = async (owner: Owner) => parseJobs((await owner.call('GET', jobsPath)).body);

  test('is a job with live byte progress that a fresh page finds again, ends as a model on disk in Hermes\'s models folder, and fetches only from the fixture', async () => {
    const owner = await start();
    const request = downloadBrowsedRequest('fixture/tiny-GGUF', ['tiny-Q8_0.gguf']);
    expect(request).toEqual({ method: 'POST', path: '/api/local-models/download-browsed', body: { repo: 'fixture/tiny-GGUF', paths: ['tiny-Q8_0.gguf'] } });

    const gate = hub.hold();
    const started = await owner.call<{ job_id: string; model_id: string }>(request.method, request.path, { body: request.body });
    expect(started.status).toBe(200);
    expect(started.body.model_id).toBe('tiny-Q8_0');
    await gate.reached;

    // Held while the file is on its way: a running job that knows its size. A page opened now (a new Caduceus server, no state of its own) finds it.
    // (Hermes reads the body in 4 MB steps, so its byte count only moves once a step is in; a fixture of kilobytes shows the count at the end.)
    await server?.close();
    const reloaded = await start();
    const running = (await jobsOf(reloaded)).find((job) => job.id === started.body.job_id)!;
    expect(running).toMatchObject({ kind: 'model-download', status: 'running', target: 'tiny-Q8_0 (from fixture/tiny-GGUF)', totalBytes: 128 * 1024 });
    expect(running.percent).toBe(0);

    gate.release();
    // Hermes finishes in a thread of its own process: follow the job the way the screen does, by asking its list again until it is not running (each ask is a request, and the test's timeout bounds it).
    let done = running;
    while (done.status === 'running') {
      done = (await jobsOf(reloaded)).find((job) => job.id === started.body.job_id)!;
      await new Promise((resolve) => setImmediate(resolve));
    }
    expect(done).toMatchObject({ status: 'done', percent: 100, doneBytes: 128 * 1024 });

    expect(fs.readFileSync(path.join(hermes.home, 'models', 'tiny-Q8_0.gguf'))).toEqual(fixtureBytes(128 * 1024));
    const status = parseStatus((await reloaded.call('GET', '/api/local-models/status')).body);
    expect(status.models).toEqual([{ id: 'tiny-Q8_0', sizeBytes: 128 * 1024, sizeLabel: '128 KB', residency: undefined, active: false }]);
    expect(new Set(hub.fetched)).toEqual(new Set(['tiny-Q8_0.gguf']));
    // Only huggingface.co was ever reached: no other address was asked for. (Hermes's background catalogue refresh may be refused, never served.)
    expect(hub.refused.every((host) => host !== 'huggingface.co')).toBe(true);
  });
});

describe('a model on this Mac', () => {
  let shelf: string;
  beforeAll(() => {
    shelf = fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-gguf-'));
  });
  afterAll(() => {
    fs.rmSync(shelf, { recursive: true, force: true });
  });
  const statusOf = async (owner: Owner) => parseStatus((await owner.call('GET', '/api/local-models/status')).body);

  test('is sideloaded from a file already on the Mac without copying it, and a file that is not a GGUF is refused', async () => {
    const owner = await start();
    const file = path.join(shelf, 'mine-Q4.gguf');
    fs.writeFileSync(file, fixtureBytes(48 * 1024));
    const request = sideloadRequest(file);
    expect(request).toEqual({ method: 'POST', path: '/api/local-models/sideload', body: { path: file } });
    expect((await owner.call(request.method, request.path, { body: request.body })).status).toBe(200);

    const status = await statusOf(owner);
    expect(status.models.find((model) => model.id === 'mine-Q4')).toMatchObject({ sizeBytes: 48 * 1024, sizeLabel: '48 KB', active: false });
    // Linked into Hermes's folder, not copied: one file, two names.
    expect(fs.statSync(path.join(hermes.home, 'models', 'mine-Q4.gguf')).ino).toBe(fs.statSync(file).ino);

    const text = path.join(shelf, 'notes.txt');
    fs.writeFileSync(text, 'not a model');
    const refused = await owner.call(request.method, request.path, { body: { path: text } });
    expect(refused.status).toBe(422);
    expect(JSON.stringify(refused.body)).toContain('Pick a .gguf model file');
  });

  test('cannot be started while the runtime is missing: Hermes\'s job fails with its own words, the profile\'s model is not changed, and nothing is loaded', async () => {
    const owner = await start();
    const before = (await owner.call<{ main: { model: string } }>('GET', '/api/model/auxiliary?profile=default')).body.main;
    const request = activateRequest('mine-Q4', 'default');
    expect(request.path).toBe('/api/local-models/activate?profile=default');
    const started = await owner.call<{ job_id: string }>(request.method, request.path, { body: request.body });
    expect(started.status).toBe(200);
    let job = parseJobs((await owner.call('GET', jobsPath)).body).find((candidate) => candidate.id === started.body.job_id)!;
    // The job runs in a thread of Hermes's process: ask its list again until it has ended.
    while (job.status === 'running') {
      job = parseJobs((await owner.call('GET', jobsPath)).body).find((candidate) => candidate.id === started.body.job_id)!;
      await new Promise((resolve) => setImmediate(resolve));
    }
    expect(job).toMatchObject({ kind: 'model-activate', status: 'error' });
    expect(job.error).toBe('The local server could not start — check the runtime is installed');
    expect((await owner.call('GET', '/api/model/auxiliary?profile=default')).body).toMatchObject({ main: before });
    // Ejecting needs a server; starting one needs the runtime.
    const eject = ejectRequest('mine-Q4');
    expect((await owner.call(eject.method, eject.path, { body: eject.body })).status).toBe(409);
    const serverStart = serverRequest('start');
    expect(serverStart.body).toEqual({ action: 'start' });
    expect((await owner.call(serverStart.method, serverStart.path, { body: serverStart.body })).status).toBe(502);
    expect((await statusOf(owner)).runtime).toMatchObject({ installed: false, serverRunning: false });
  });

  test('is deleted by id: its file goes, the original of a sideloaded one stays, and the screen can say how much space was freed', async () => {
    const owner = await start();
    const before = await statusOf(owner);
    const model = before.models.find((candidate) => candidate.id === 'mine-Q4')!;
    const request = deleteRequest(model.id);
    expect(request).toEqual({ method: 'DELETE', path: '/api/local-models/models/mine-Q4' });
    expect((await owner.call(request.method, request.path)).status).toBe(200);
    expect((await statusOf(owner)).models.map((candidate) => candidate.id)).not.toContain('mine-Q4');
    expect(fs.existsSync(path.join(hermes.home, 'models', 'mine-Q4.gguf'))).toBe(false);
    expect(fs.existsSync(path.join(shelf, 'mine-Q4.gguf'))).toBe(true);
    expect(freedMessage(model)).toBe('Deleted mine-Q4: 48 KB of disk space freed.');
    // A model that is not there is Hermes's plain 404.
    expect((await owner.call(request.method, request.path)).status).toBe(404);
  });
});

describe('the shared model picker', () => {
  test('lists a model on disk under Hermes\'s Local provider, so it can be chosen for the main model or a slot; until the local server is on, Hermes refuses to assign it and says why', async () => {
    const owner = await start();
    const file = path.join(os.tmpdir(), `caduceus-picker-${process.pid}-Q4.gguf`);
    fs.writeFileSync(file, fixtureBytes(1024));
    try {
      await owner.call('POST', '/api/local-models/sideload', { body: { path: file } });
      const id = path.basename(file, '.gguf');
      const catalogue = parseCatalogue((await owner.call('GET', '/api/model/options?profile=default')).body);
      const local = catalogue.providers.find((provider) => provider.slug === LOCAL_PROVIDER)!;
      expect(local).toMatchObject({ name: 'Local', state: 'ready' });
      // The downloaded fixture model is on disk too (an earlier test): every model on disk is listed.
      expect(local.models.map((model) => model.id)).toEqual(expect.arrayContaining([id, 'tiny-Q8_0']));

      const refused = await owner.call<{ detail: string }>('POST', '/api/model/set?profile=default', { body: { scope: 'main', provider: LOCAL_PROVIDER, model: id } });
      expect(refused.status).toBe(400);
      // Hermes's words depend on whether the server was switched off ("is turned off", the first time) or failed to start ("isn't running"); both name the local model server.
      expect(refused.body.detail).toMatch(/^The local model server (is turned off|isn't running)/);
      expect((await owner.call<{ main: { model: string } }>('GET', '/api/model/auxiliary?profile=default')).body.main.model).toBe('');
    } finally {
      await owner.call('DELETE', `/api/local-models/models/${encodeURIComponent(path.basename(file, '.gguf'))}`);
      fs.rmSync(file, { force: true });
    }
  });
});
