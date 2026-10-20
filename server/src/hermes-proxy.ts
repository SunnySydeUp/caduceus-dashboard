// The browser's way to Hermes's REST API: every request goes through the policy before it is forwarded.
import type { Hono } from 'hono';
import type { PolicyRefusal } from '@caduceus/contracts/caduceus-api';
import { CONFIG_SECRET_MASK, maskConfigSecrets } from '@caduceus/contracts/config-keys';
import { maskRawConfig, parseRawConfig, unmaskWrite } from './config-raw.ts';
import { guardPlatformSecrets } from './channel-secrets.ts';
import { guardEndpointSecrets, guardEnvSecrets, guardOauthSecrets, guardPoolSecrets, guardVoiceSecrets } from './credential-guard.ts';
import { guardWebhookSecrets } from './webhook-secrets.ts';
import { stampAuthor } from './kanban-author.ts';
import { authClient, type AuthEnv } from './auth-routes.ts';
import type { HermesBackend } from './hermes-backend.ts';
import { sendSessionWrite } from './session-fence.ts';
import { BASE_HEADER, type BehaviourFiles } from './behaviour-files.ts';
import type { RestPolicy } from './policy.ts';
import { isRestore, type Restore } from './restore.ts';

/**
 * Reads a request's body, or gives up as soon as it is over `maxBytes`: by its declared length when it has one, and by
 * counting what arrives when it has not. The body is never buffered past the limit.
 */
export async function readBody(request: Request, maxBytes: number): Promise<Uint8Array<ArrayBuffer> | 'too-large'> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) return 'too-large';
  if (!request.body) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = request.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maxBytes) {
      await reader.cancel();
      return 'too-large';
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }
  return body;
}

/** The guard of the answer to a request that lists credentials, by the route as the policy classified it; `undefined` for a route whose answer lists none. */
function credentialGuard(method: string, pathname: string): ((answer: unknown) => unknown) | undefined {
  if (method === 'GET') {
    if (pathname === '/api/env') return guardEnvSecrets;
    if (pathname === '/api/credentials/pool') return guardPoolSecrets;
    if (pathname === '/api/providers/oauth') return guardOauthSecrets;
    if (pathname === '/api/audio/voice-config') return guardVoiceSecrets;
    return pathname === '/api/providers/custom-endpoints' ? guardEndpointSecrets : undefined;
  }
  // A write to the custom endpoints answers with the list again.
  return (method === 'POST' && pathname === '/api/providers/custom-endpoints') || (method === 'DELETE' && pathname.startsWith('/api/providers/custom-endpoints/')) ? guardEndpointSecrets : undefined;
}

type UnmaskedBody = { ok: true; body: Uint8Array<ArrayBuffer> } | { ok: false; unresolved: string[] };

/** A config save with its masks put back as the credentials Hermes holds for the profile the save is for (see `config-raw.ts`). */
async function unmaskConfigWrite(backend: HermesBackend, incoming: URL, routed: string, body: Uint8Array<ArrayBuffer>): Promise<UnmaskedBody> {
  const text = new TextDecoder().decode(body);
  // Most saves hold no mask; text that is not JSON is Hermes's to refuse.
  if (!text.includes(CONFIG_SECRET_MASK)) return { ok: true, body };
  const parsed: unknown = (() => {
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  })();
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { ok: true, body };
  const record = parsed as Record<string, unknown>;
  const profile = typeof record.profile === 'string' && record.profile !== '' ? record.profile : incoming.searchParams.get('profile');
  const res = await backend.fetch(`/api/config/raw${profile ? `?profile=${encodeURIComponent(profile)}` : ''}`);
  const file: unknown = await res.json().catch(() => undefined);
  const current = typeof file === 'object' && file !== null && 'yaml' in file && typeof file.yaml === 'string' ? parseRawConfig(file.yaml) : undefined;
  const route = routed === '/api/config' ? 'config' : routed === '/api/mcp/servers' ? 'mcp' : 'raw';
  const unmasked = unmaskWrite(route, record, current);
  return unmasked.ok ? { ok: true, body: new TextEncoder().encode(unmasked.body) } : unmasked;
}

/**
 * `behaviour` keeps what a write to a profile's behaviour files replaces and refuses a stale overwrite (`behaviour-files.ts`).
 * `onKanbanWrite` is told when a write to Hermes's Kanban plugin has been accepted: Hermes records no event for some of
 * them (a delete), so the pages watching a board are told by Caduceus instead (`kanban-events-proxy.ts`).
 * `restore` surrounds a backup restore (`/api/ops/import*`) with the drain before it and the restarts after it (`restore.ts`).
 */
export function mountHermesProxy(app: Hono<AuthEnv>, backend: HermesBackend, policy: RestPolicy, behaviour: BehaviourFiles, restore: Restore, onKanbanWrite: () => void = () => {}): void {
  app.all('/api/*', async (c) => {
    const incoming = new URL(c.req.url);
    const requester = { sessionId: c.get('session')?.id, source: authClient(c).source };
    const prepared = policy.prepare(c.req.method, incoming.pathname, requester);
    if (!prepared.allow) return c.json(prepared.body, prepared.status);
    // While Hermes is down, answer at once with its state rather than holding the request open.
    if (backend.status.state !== 'ready') return c.json(backend.status, 503);
    const body = c.req.method === 'GET' || c.req.method === 'HEAD' ? undefined : await readBody(c.req.raw, prepared.maxBodyBytes);
    if (body === 'too-large') {
      const refusal: PolicyRefusal = { error: 'payload-too-large', tier: prepared.match.policy.tier, operation: prepared.match.operation, message: 'The request is too large for Caduceus to forward.', maxBytes: prepared.maxBodyBytes };
      return c.json(refusal, 413);
    }
    let contentType = c.req.header('content-type');
    const decision = await policy.decide(prepared, { method: c.req.method, search: incoming.search, contentType, confirmation: c.req.header('x-caduceus-confirmation'), body }, requester);
    if (!decision.allow) return c.json(decision.body, decision.status);
    const held = await behaviour.beforeWrite({ operation: prepared.match.operation, params: prepared.match.params, query: new URLSearchParams(incoming.search), body, baseSha256: c.req.header(BASE_HEADER) });
    if (held) return c.json(held.body, held.status);
    // Hermes decodes escapes before it routes, so what the answer is judged by is the path as it was classified (`/api/config/%72aw` is the raw config).
    const routed = new URL(decision.target, 'http://hermes').pathname;
    // A comment or an upload is by the owner whatever the page said it was by.
    const stamped = body && (await stampAuthor(c.req.method, new URL(decision.target, 'http://hermes').pathname, contentType, body));
    if (stamped) contentType = stamped.contentType;
    // A config the page was given is masked, so a save that sends one back must not write the mask over the credential.
    let forwarded: Uint8Array<ArrayBuffer> | undefined = stamped ? stamped.body : body;
    const configWrite = c.req.method === 'PUT' && (routed === '/api/config' || routed === '/api/config/raw' || routed === '/api/mcp/servers');
    if (configWrite && body !== undefined) {
      const unmasked = await unmaskConfigWrite(backend, incoming, routed, body);
      if (!unmasked.ok) {
        return c.json({ error: 'masked-secret', message: `A masked credential has no value to stand for: ${unmasked.unresolved.join(', ')}. Remove it or enter the value.`, keys: unmasked.unresolved }, 422);
      }
      forwarded = unmasked.body;
    }
    // A restore replaces files that Hermes and Caduceus hold open: Caduceus drains first, and restarts after Hermes has imported.
    const restoring = isRestore(prepared.match.operation) ? await restore.begin() : undefined;
    if (restoring && !restoring.ok) return c.json(restoring.body, restoring.status as 409);
    // Hermes 0.22 commits a session write only against its identity and the revision it was made from; the page has neither, so they are added here (`session-fence.ts`).
    // What is forwarded is the path as it was classified: Hermes decodes escapes before it routes.
    const upstream = await sendSessionWrite(backend, c.req.method, decision.target, forwarded, { headers: { 'content-type': contentType ?? 'application/json' } })
      .catch((error: unknown) => {
        if (restoring?.ok) restoring.run.refused();
        throw error;
      });
    if (restoring?.ok) {
      if (upstream.ok) restoring.run.accepted();
      else restoring.run.refused();
    }
    if (upstream.ok && c.req.method !== 'GET' && c.req.method !== 'HEAD' && routed.startsWith('/api/plugins/kanban/')) onKanbanWrite();
    // The one answer that carries credentials, even redacted: Caduceus checks the redaction itself (`channel-secrets.ts`).
    if (upstream.ok && c.req.method === 'GET' && routed === '/api/messaging/platforms') {
      const answer: unknown = await upstream.json().catch(() => undefined);
      if (answer !== undefined) return c.json(guardPlatformSecrets(answer));
      return c.json({ error: 'bad-upstream', message: 'Hermes did not answer with a list of platforms.' }, 502);
    }
    // The answers that list credentials are rebuilt from the fields that are safe to show (`credential-guard.ts`): Hermes redacts a key to its
    // first and last characters and a token to its last, and no part of a credential reaches the page. A reveal (T3) is the one way to see one.
    const guard = credentialGuard(c.req.method, routed);
    if (upstream.ok && guard) {
      const answer: unknown = await upstream.json().catch(() => undefined);
      if (answer !== undefined) return c.json(guard(answer));
      return c.json({ error: 'bad-upstream', message: 'Hermes did not answer with the credentials it lists.' }, 502);
    }
    // The config holds credentials (`auxiliary.*.api_key`, the dashboard's password): the page is told that one is set, never its value.
    if (upstream.ok && c.req.method === 'GET' && routed === '/api/config') {
      const answer: unknown = await upstream.json().catch(() => undefined);
      if (answer !== undefined) return c.json(maskConfigSecrets(answer));
      return c.json({ error: 'bad-upstream', message: 'Hermes did not answer with its config.' }, 502);
    }
    // The raw file is the config again, as text.
    if (upstream.ok && c.req.method === 'GET' && routed === '/api/config/raw') {
      const answer: unknown = await upstream.json().catch(() => undefined);
      if (typeof answer === 'object' && answer !== null && 'yaml' in answer && typeof answer.yaml === 'string') return c.json({ ...answer, yaml: maskRawConfig(answer.yaml) });
      return c.json({ error: 'bad-upstream', message: 'Hermes did not answer with its config file.' }, 502);
    }
    // The list of webhooks has no secret in it, and Caduceus makes sure of that (`webhook-secrets.ts`).
    if (upstream.ok && c.req.method === 'GET' && routed === '/api/webhooks') {
      const answer: unknown = await upstream.json().catch(() => undefined);
      if (answer !== undefined) return c.json(guardWebhookSecrets(answer));
      return c.json({ error: 'bad-upstream', message: 'Hermes did not answer with a list of webhooks.' }, 502);
    }
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        'content-type': upstream.headers.get('content-type') ?? 'application/octet-stream',
        // A download carries its file name.
        ...(upstream.headers.get('content-disposition') ? { 'content-disposition': upstream.headers.get('content-disposition')! } : {}),
      },
    });
  });
}
