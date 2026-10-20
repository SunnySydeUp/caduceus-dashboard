// A Hindsight API server on this machine for tests (M4 #10). It speaks the routes, query parameters, request bodies and response shapes of
// Hindsight's published OpenAPI document (https://hindsight.vectorize.io/openapi.json, "Hindsight HTTP API" 1.0.0), which is also what the
// client Hermes's Hindsight memory provider uses (`hindsight-client`, plugins/memory/hindsight) calls: `GET /version`, `GET /health`,
// `GET /v1/default/banks`, `GET …/banks/{bank}/stats`, `GET …/memories/list`, `POST …/memories/recall`, `POST …/reflect`,
// `POST …/memories` (retain), `GET …/directives` and `GET …/mental-models[/{id}]`. Only the routes Caduceus calls exist; any other route is a 404,
// so a test shows that Caduceus calls nothing else. Authentication is Hindsight's bearer key (`Authorization: Bearer <key>`), which the
// provider sends in the same way (`_fetch_hindsight_api_version`, `templates._bank_request`).
//
// What is NOT verified against a real Hindsight: the exact body of a 401 (FastAPI's `{ "detail": … }` is assumed) and the ranking of recall, which here
// is a plain word match. Memory units a test seeds are held in memory and gone when the stub closes.
import http from 'node:http';
import type { AddressInfo } from 'node:net';

/** A unit of memory as `GET …/memories/list` returns it (`MemoryUnitListItem`). */
export interface StubMemory {
  id: string;
  text: string;
  fact_type: 'world' | 'experience' | 'observation';
  context?: string;
  document_id?: string | null;
  tags?: string[];
  mentioned_at?: string;
}

export interface StubDirective {
  id: string;
  name: string;
  content: string;
  priority: number;
  is_active: boolean;
  tags: string[];
}

export interface StubMentalModel {
  id: string;
  name: string;
  source_query: string;
  content: string;
  tags: string[];
}

export interface StubBank {
  id: string;
  name?: string;
  mission?: string;
  memories: StubMemory[];
  directives: StubDirective[];
  mentalModels: StubMentalModel[];
}

/** What the stub was asked, so a test can tell what reached it and with which credential. */
export interface StubRequest {
  method: string;
  path: string;
  search: string;
  /** The `Authorization` header as it came, or `undefined`. */
  authorization: string | undefined;
  body: unknown;
}

export interface HindsightStub {
  readonly url: string;
  readonly requests: StubRequest[];
  /** The bank with this id (created empty when it is not there yet), to seed or to read what was retained. */
  bank(id: string): StubBank;
  /** Starts requiring this bearer key; without one every request is accepted. */
  requireKey(key: string | undefined): void;
  /** Makes the server answer HTTP 500 to every request until reset. */
  fail(on: boolean): void;
  /** Forgets every bank, every request and the key and failure switches, as a new server would be. */
  reset(): void;
  /** Stops listening (the next request is refused by the network). */
  close(): Promise<void>;
}

const words = (text: string) => text.toLowerCase().match(/[a-z0-9]+/g) ?? [];

export async function startHindsightStub(): Promise<HindsightStub> {
  const banks = new Map<string, StubBank>();
  const requests: StubRequest[] = [];
  let key: string | undefined;
  let failing = false;
  let counter = 0;
  const bank = (id: string): StubBank => {
    let found = banks.get(id);
    if (!found) banks.set(id, (found = { id, memories: [], directives: [], mentalModels: [] }));
    return found;
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://stub');
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const text = Buffer.concat(chunks).toString('utf8');
    const body: unknown = text ? JSON.parse(text) : undefined;
    requests.push({ method: req.method ?? 'GET', path: url.pathname, search: url.search, authorization: req.headers.authorization, body });
    const send = (status: number, payload: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
    };
    if (failing) return send(500, { detail: 'Internal Server Error' });
    if (url.pathname === '/health' || url.pathname === '/version') {
      if (url.pathname === '/health') return send(200, { status: 'healthy', database: 'connected' });
      return send(200, { api_version: '0.6.2', features: { observations: true, mcp: true, worker: true, bank_config_api: true, bank_llm_health: true, file_upload_api: true, document_export_api: true, document_import_api: true, audit_log: true, llm_trace: true, store_document_text: true } });
    }
    if (key !== undefined && req.headers.authorization !== `Bearer ${key}`) return send(401, { detail: 'Invalid or missing API key' });

    const method = req.method ?? 'GET';
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    if (parts[0] !== 'v1' || parts[1] !== 'default' || parts[2] !== 'banks') return send(404, { detail: 'Not Found' });
    if (parts.length === 3 && method === 'GET') {
      const q = url.searchParams.get('q')?.toLowerCase();
      const listed = [...banks.values()].filter((b) => !q || b.id.toLowerCase().includes(q));
      return send(200, {
        banks: listed.map((b) => ({
          bank_id: b.id,
          name: b.name ?? null,
          disposition: { skepticism: 3, literalism: 3, empathy: 3 },
          mission: b.mission ?? null,
          created_at: '2026-10-01T09:00:00Z',
          updated_at: '2026-10-02T09:00:00Z',
          fact_count: b.memories.length,
          last_document_at: null,
          last_write_at: null,
          display_alias: null,
          matched_aliases: [],
        })),
        total: listed.length,
        limit: 100,
        offset: 0,
      });
    }
    const current = bank(parts[3] ?? '');
    const rest = parts.slice(4).join('/');
    const page = (items: unknown[]) => {
      const limit = Number(url.searchParams.get('limit') ?? 100);
      const offset = Number(url.searchParams.get('offset') ?? 0);
      return { items: items.slice(offset, offset + limit), total: items.length, limit, offset };
    };

    if (method === 'GET' && rest === 'stats') {
      const byType = (type: string) => current.memories.filter((m) => m.fact_type === type).length;
      return send(200, {
        bank_id: current.id,
        total_nodes: current.memories.length,
        total_links: 0,
        total_documents: 0,
        nodes_by_fact_type: { world: byType('world'), experience: byType('experience'), observation: byType('observation') },
        links_by_link_type: {},
        links_by_fact_type: {},
        links_breakdown: {},
        pending_operations: 0,
        failed_operations: 0,
        total_observations: byType('observation'),
      });
    }
    if (method === 'GET' && rest === 'memories/list') {
      const type = url.searchParams.get('type');
      const q = url.searchParams.get('q')?.toLowerCase();
      const matching = current.memories.filter((m) => (!type || m.fact_type === type) && (!q || m.text.toLowerCase().includes(q)));
      return send(200, {
        ...page(
          matching.map((m) => ({
            id: m.id,
            text: m.text,
            context: m.context ?? '',
            date: m.mentioned_at ?? '2026-10-02T09:00:00Z',
            fact_type: m.fact_type,
            document_id: m.document_id ?? null,
            mentioned_at: m.mentioned_at ?? '2026-10-02T09:00:00Z',
            occurred_start: null,
            occurred_end: null,
            entities: '',
            chunk_id: null,
            proof_count: 1,
            tags: m.tags ?? [],
            metadata: {},
            state: 'active',
          })),
        ),
      });
    }
    if (method === 'POST' && rest === 'memories/recall') {
      const request = (body ?? {}) as { query?: string; types?: string[]; budget?: string; max_tokens?: number };
      if (typeof request.query !== 'string') return send(422, { detail: [{ loc: ['body', 'query'], msg: 'Field required', type: 'missing' }] });
      const wanted = new Set(words(request.query));
      const scored = current.memories
        .filter((m) => !request.types || request.types.includes(m.fact_type))
        .map((m) => ({ m, hits: words(m.text).filter((w) => wanted.has(w)).length }))
        .filter(({ hits }) => hits > 0)
        .sort((a, b) => b.hits - a.hits);
      return send(200, {
        results: scored.map(({ m, hits }) => ({
          id: m.id,
          text: m.text,
          type: m.fact_type,
          entities: [],
          context: m.context ?? null,
          occurred_start: null,
          occurred_end: null,
          mentioned_at: m.mentioned_at ?? '2026-10-02T09:00:00Z',
          document_id: m.document_id ?? null,
          metadata: {},
          chunk_id: null,
          tags: m.tags ?? [],
          scores: { final: hits / Math.max(1, wanted.size), semantic: null, keyword: null, reranker: null },
        })),
        trace: null,
        entities: null,
        chunks: null,
      });
    }
    if (method === 'POST' && rest === 'reflect') {
      const request = (body ?? {}) as { query?: string };
      if (typeof request.query !== 'string') return send(422, { detail: [{ loc: ['body', 'query'], msg: 'Field required', type: 'missing' }] });
      const wanted = new Set(words(request.query));
      const based = current.memories.filter((m) => words(m.text).some((w) => wanted.has(w)));
      return send(200, {
        text: based.length === 0 ? `I have nothing about “${request.query}” yet.` : `About “${request.query}”: ${based.map((m) => m.text).join(' ')}`,
        based_on: {
          memories: based.map((m) => ({ id: m.id, text: m.text, type: m.fact_type, context: m.context ?? null })),
          mental_models: current.mentalModels.map((m) => ({ id: m.id, text: m.content, context: null })),
          directives: current.directives.filter((d) => d.is_active).map((d) => ({ id: d.id, name: d.name, content: d.content })),
        },
        usage: { input_tokens: 120, output_tokens: 40, total_tokens: 160 },
      });
    }
    if (method === 'POST' && rest === 'memories') {
      const request = (body ?? {}) as { items?: { content?: unknown; context?: string; tags?: string[] }[]; async?: boolean };
      if (!Array.isArray(request.items) || request.items.some((item) => typeof item.content !== 'string')) return send(422, { detail: [{ loc: ['body', 'items'], msg: 'Field required', type: 'missing' }] });
      for (const item of request.items) current.memories.push({ id: `mem-${++counter}`, text: item.content as string, fact_type: 'world', context: item.context, tags: item.tags });
      return send(200, { success: true, bank_id: current.id, items_count: request.items.length, async: request.async === true, operation_id: null, operation_ids: null, usage: null });
    }
    if (method === 'GET' && rest === 'directives') {
      const active = url.searchParams.get('active_only') !== 'false';
      return send(200, page(current.directives.filter((d) => !active || d.is_active).map((d) => ({ ...d, bank_id: current.id, created_at: '2026-10-01T09:00:00Z', updated_at: null }))));
    }
    if (method === 'GET' && rest === 'mental-models') {
      const detail = url.searchParams.get('detail') ?? 'full';
      return send(
        200,
        page(
          current.mentalModels.map((m) => ({
            id: m.id,
            bank_id: current.id,
            name: m.name,
            source_query: m.source_query,
            ...(detail === 'metadata' ? {} : { content: m.content }),
            tags: m.tags,
            max_tokens: 2048,
            trigger: null,
            last_refreshed_at: '2026-10-02T09:00:00Z',
            created_at: '2026-10-01T09:00:00Z',
            is_stale: false,
          })),
        ),
      );
    }
    return send(404, { detail: 'Not Found' });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    bank,
    requireKey: (value) => {
      key = value;
    },
    fail: (on) => {
      failing = on;
    },
    reset: () => {
      banks.clear();
      requests.length = 0;
      key = undefined;
      failing = false;
    },
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
