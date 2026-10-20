import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { SessionCreateResult, SessionLiveInfo, ToolsetsListResult, ToolsShowResult } from '@caduceus/contracts/hermes/gateway';
import type { GatewayEvent } from '@caduceus/contracts/hermes/shared/gateway';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { markerMismatches } from '../src/contract-diff.ts';
import { loadPinnedContracts } from '../src/hermes-contract.ts';
import { openGatewayConnection, type TestGatewayConnection } from './fixtures/gateway-client.ts';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { startStubLlm, type StubLlm } from './fixtures/stub-llm.ts';
import { ownerCookie } from './fixtures/owner.ts';

// What `source` does to the tools of a session Caduceus creates (architecture §3, "Session source"), checked over the browser's
// gateway connection through Caduceus, against the real Hermes (a real `hermes serve` in a throwaway HERMES_HOME). Hermes decides
// a session's tools from its source (`tui_gateway/server.py` `_gui_surface_toolsets`); the stub LLM stands in for the provider an
// agent needs in order to be built, and records what it is asked, so that "no prompt was sent" is something it can say.
let hermes: TestHermes;
let llm: StubLlm;
let server: CaduceusServer | undefined;
let page: TestGatewayConnection | undefined;
beforeAll(async () => {
  hermes = await launchTestHermes();
  await hermes.backend.ready();
  llm = await startStubLlm();
  await llm.connect(hermes);
}, 60_000);
afterAll(async () => {
  await llm.close();
  await hermes.stop();
});
afterEach(async () => {
  page?.connection.close();
  page = undefined;
  await server?.close();
  server = undefined;
  fs.rmSync(path.join(hermes.home, 'caduceus'), { recursive: true, force: true });
});

/** The page's gateway connection as the owner, with Hermes's `session.info` and `error` events of every session collected. */
async function openPage() {
  server = await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home });
  const cookie = await ownerCookie(server.url);
  page = openGatewayConnection(server.url, cookie);
  await page.until((status) => status.state === 'connected');
  const { client } = page.connection;
  const infos: GatewayEvent<'session.info'>[] = [];
  const errors: GatewayEvent<'error'>[] = [];
  const listeners = new Set<() => void>();
  client.on('session.info', (event) => {
    infos.push(event);
    listeners.forEach((listener) => listener());
  });
  client.on('error', (event) => {
    errors.push(event);
    listeners.forEach((listener) => listener());
  });

  /**
   * Creates a session with `source` and resolves once Hermes has built its agent. `session.create` answers at once with a lazy
   * session whose `tools` is empty, and builds the agent about 50 ms later: the `session.info` event that follows is the first
   * with tools in it. Until then Hermes has no agent to say what is enabled, and `tools.show` lists every tool there is.
   */
  async function createBuilt(params: { source?: string }) {
    const created = await client.request<SessionCreateResult>('session.create', params);
    const { promise, resolve, reject } = Promise.withResolvers<SessionLiveInfo>();
    const settle = () => {
      const failed = errors.find((event) => event.session_id === created.session_id);
      if (failed) return reject(new Error(String(failed.payload?.message)));
      const built = infos.find((event) => event.session_id === created.session_id && Object.keys(event.payload?.tools ?? {}).length > 0);
      if (built?.payload) resolve(built.payload);
    };
    listeners.add(settle);
    settle();
    const built = await promise;
    listeners.delete(settle);
    return { created, built };
  }

  /** What an inspection method says a built session has: every tool name, by toolset, and which toolsets are enabled for it. */
  async function inspect(sessionId: string) {
    const shown = await client.request<ToolsShowResult>('tools.show', { session_id: sessionId });
    const toolsets = await client.request<ToolsetsListResult>('toolsets.list', { session_id: sessionId });
    return {
      byToolset: Object.fromEntries(shown.sections.map((section) => [section.name, section.tools.map((tool) => tool.name)])),
      names: shown.sections.flatMap((section) => section.tools.map((tool) => tool.name)).sort(),
      enabled: toolsets.toolsets.filter((toolset) => toolset.enabled).map((toolset) => toolset.name),
    };
  }

  return { url: server.url, cookie, client, createBuilt, inspect };
}

/** Hermes's own session store, read where Hermes keeps it: the one place that cannot hide a row from a list. */
function storedSessions(): { id: string; source: string }[] {
  const db = new DatabaseSync(path.join(hermes.home, 'state.db'), { readOnly: true });
  try {
    return db.prepare('SELECT id, source FROM sessions').all() as { id: string; source: string }[];
  } finally {
    db.close();
  }
}

describe('the toolset of a session Caduceus creates, in front of the real Hermes', () => {
  test('source "caduceus" gets Hermes\'s normal tools and none of the Desktop-only bridges; no prompt is sent and no session row is left', async () => {
    const { url, cookie, client, createBuilt, inspect } = await openPage();

    const { created } = await createBuilt({ source: 'caduceus' });
    const tools = await inspect(created.session_id);

    // Hermes's normal tools: files, terminal, memory, clarify questions, delegation, code, skills; and the projects tool, which
    // writes Hermes's own projects store, so nothing in the browser has to answer it.
    expect(tools.names).toEqual(
      expect.arrayContaining(['read_file', 'write_file', 'patch', 'search_files', 'terminal', 'memory', 'clarify', 'delegate_task', 'execute_code', 'skill_view', 'desktop_project']),
    );
    // The Desktop-only bridges (hermes-protocol.md §12) are tools the Desktop window answers: preview, terminal read, tour, window read.
    expect(tools.byToolset.desktop_ui).toBeUndefined();
    expect(tools.enabled).not.toContain('desktop_ui');
    expect(tools.enabled).toContain('project');
    expect(tools.names).not.toContain('desktop_preview');
    expect(tools.names).not.toContain('read_terminal');
    expect(tools.names).not.toContain('gui_tour');
    expect(tools.names).not.toContain('read_window_below');
    // Hermes shows the model only the tools it lists directly: it defers the Desktop bridges behind `tool_search` even for "desktop",
    // so the lists above, which include what is deferred, are what tells the sources apart.

    // Closing the session ends its runtime...
    await client.request('session.close', { session_id: created.session_id });
    await expect(client.request('session.active_list', {})).resolves.toEqual({ sessions: [] });
    // ...and it never had a row: Hermes writes one at the first prompt, and none was sent. The stub LLM was only asked about
    // its models, never for a completion, and neither Hermes's store nor its Sessions list holds anything.
    expect(llm.requests.filter((request) => /\/(chat\/completions|completions|responses|messages)$/.test(request))).toEqual([]);
    expect(storedSessions()).toEqual([]);
    const listed = await fetch(`${url}/api/sessions?archived=include&limit=100`, { headers: { cookie } });
    expect(await listed.json()).toMatchObject({ sessions: [], total: 0 });
  });

  test('what source "desktop" adds is the Desktop-only bridges, and a session with no source gets the same tools as "caduceus"', async () => {
    const { client, createBuilt, inspect } = await openPage();

    const caduceus = await createBuilt({ source: 'caduceus' });
    const unspecified = await createBuilt({});
    const desktop = await createBuilt({ source: 'desktop' });
    const toolsOf = {
      caduceus: await inspect(caduceus.created.session_id),
      unspecified: await inspect(unspecified.created.session_id),
      desktop: await inspect(desktop.created.session_id),
    };

    // "caduceus" is not special to Hermes: an unknown source gets what a session with none does, Hermes's default tools.
    expect(toolsOf.caduceus.names).toEqual(toolsOf.unspecified.names);
    // "desktop" gets Hermes's Desktop-only client toolsets on top (`CLIENT_SURFACE_TOOLSETS` in its toolsets.py: `desktop_ui` with the four bridges, and since 0.22
    // `catalog`, the install requests answered by the Desktop approval card), and nothing else.
    const bridges = toolsOf.desktop.byToolset.desktop_ui;
    expect(bridges).toEqual(expect.arrayContaining(['desktop_preview', 'read_terminal', 'gui_tour', 'read_window_below']));
    const clientTools = [...bridges, ...(toolsOf.desktop.byToolset.catalog ?? [])].sort();
    expect(toolsOf.desktop.names.filter((name) => !toolsOf.caduceus.names.includes(name))).toEqual(clientTools);
    expect(toolsOf.desktop.enabled).toContain('desktop_ui');
    expect(toolsOf.desktop.enabled.filter((name) => name !== 'desktop_ui' && name !== 'catalog')).toEqual(toolsOf.caduceus.enabled);

    for (const { created } of [caduceus, unspecified, desktop]) await client.request('session.close', { session_id: created.session_id });
    expect(storedSessions()).toEqual([]);
  });

  test('Hermes reports the desktop contract number its pins were taken from, in session.create and in the built session\'s session.info', async () => {
    const { client, createBuilt } = await openPage();
    const { markers } = await loadPinnedContracts();

    const { created, built } = await createBuilt({ source: 'caduceus' });

    // Only session.info carries the number (architecture §6). Feeding it to the compatibility check is M1 #03's.
    expect(created.info.desktop_contract).toBe(markers.desktopContract);
    expect(built.desktop_contract).toBe(markers.desktopContract);
    expect(markerMismatches(markers, { ...markers, desktopContract: Number(built.desktop_contract) })).toEqual([]);
    await client.request('session.close', { session_id: created.session_id });
  });
});
