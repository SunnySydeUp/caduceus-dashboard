// Caduceus as an MCP server, the Caduceus side (M4 #11): `POST /_caduceus/mcp/tools/<tool>`, which the stdio server (`mcp-main.ts`) calls
// for every tool call an agent makes. The caller is not a browser and has no session: it holds the scoped token (`mcp-token.ts`), from
// this Mac only, and may reach only these tools. Each tool's calls to Hermes go through the same policy as the web app's, as the actor
// `mcp:<client>` with no step-up (a T2 or T3 action is refused, with the reason in the answer), so read-only mode, tiers and the audit log
// apply exactly as they do for the owner. `GET /_caduceus/api/mcp-server` is the owner's side: what Agents › Tools & MCP shows.
import type { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { McpServerInfo } from '@caduceus/contracts/caduceus-api';
import { isRecord } from '@caduceus/contracts/policy/guards';
import type { Tier } from '@caduceus/contracts/policy/tiers';
import { authClient, isDirectLocal, type AuthEnv } from './auth-routes.ts';
import type { AuditLog } from './audit-log.ts';
import type { GatewayPolicy } from './gateway-policy.ts';
import type { HermesBackend } from './hermes-backend.ts';
import { argumentProblem, MCP_CLIENT_HEADER, MCP_TOOLS, MCP_TOOL_ROUTE, toolNamed, type CallOutcome, type HermesCalls } from './mcp-tools.ts';
import type { McpToken } from './mcp-token.ts';
import type { RestPolicy } from './policy.ts';
import { sendSessionWrite } from './session-fence.ts';

/** The most a Hermes call of a tool may take before the agent is told Hermes did not answer. */
const HERMES_ANSWER_TIMEOUT_MS = 30_000;

/** What an MCP client calls itself is the client's word: a short, plain name, or `unknown`. */
const CLIENT_NAME = /^[\w .@/:+-]{1,64}$/;

const STEP_UP_MESSAGE = 'This needs the owner’s passkey confirmation, which an MCP server cannot give. Ask the owner to do it in Caduceus.';

export interface McpRoutesDeps {
  backend: HermesBackend;
  token: McpToken;
  audit: AuditLog;
  policy: RestPolicy;
  gatewayPolicy: GatewayPolicy;
  /** What the owner's page shows about the server: the registration command's parts. */
  info(): McpServerInfo;
}

const unavailable: CallOutcome = { ok: false, status: 503, error: { error: 'hermes-unavailable', message: 'Hermes is not running, so Caduceus cannot answer yet.' } };

/** A refusal by the policy as the agent is told it: the policy's own body, and a message that says what to do. */
function refusal(status: number, body: Record<string, unknown>): CallOutcome {
  const message = body.error === 'step-up-required' || typeof body.message !== 'string' ? STEP_UP_MESSAGE : body.message;
  return { ok: false, status, error: { ...body, message } };
}

/** What a failed Hermes REST answer says, in one line. */
function detailOf(body: unknown, status: number): string {
  if (isRecord(body) && typeof body.detail === 'string') return body.detail;
  if (isRecord(body) && typeof body.message === 'string') return body.message;
  return `Hermes answered HTTP ${status}.`;
}

/** The calls of one tool run, made through the policy as `actor`. */
function hermesCalls({ backend, policy, gatewayPolicy }: McpRoutesDeps, actor: string, source: string): HermesCalls {
  const requester = { source, actor };
  return {
    async rpc(method, params) {
      const frames = gatewayPolicy.connect({ sessionId: actor, source, actor });
      const verdict = await frames.fromBrowser(JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }));
      if (verdict.forward === undefined) {
        const answer: unknown = JSON.parse(verdict.reply ?? '{}');
        const data = isRecord(answer) && isRecord(answer.error) && isRecord(answer.error.data) ? answer.error.data : { error: 'denied' };
        return refusal(403, data);
      }
      if (backend.status.state !== 'ready') return unavailable;
      let socket;
      try {
        socket = await backend.openGateway({ handshakeTimeoutMs: HERMES_ANSWER_TIMEOUT_MS });
      } catch {
        return unavailable;
      }
      const { promise, resolve } = Promise.withResolvers<CallOutcome>();
      const timer = setTimeout(() => resolve({ ok: false, status: 504, error: { error: 'hermes-timeout', message: `Hermes did not answer ${method}.` } }), HERMES_ANSWER_TIMEOUT_MS);
      socket.on('close', () => resolve(unavailable));
      socket.on('message', (data) => {
        let frame: unknown;
        try {
          frame = JSON.parse(backend.redact(String(data)));
        } catch {
          return;
        }
        if (!isRecord(frame)) return;
        // The first frame is always `gateway.ready`: the call goes after it.
        if (frame.method === 'event' && isRecord(frame.params) && frame.params.type === 'gateway.ready') {
          socket.send(verdict.forward!);
          return;
        }
        if (frame.id !== 1) return;
        if (isRecord(frame.error)) {
          const code = typeof frame.error.code === 'number' ? frame.error.code : 0;
          const message = typeof frame.error.message === 'string' ? frame.error.message : 'Hermes refused the call.';
          resolve({ ok: false, status: 422, error: { error: 'hermes-error', code, message } });
        } else resolve({ ok: true, result: frame.result });
      });
      try {
        return await promise;
      } finally {
        clearTimeout(timer);
        socket.close();
      }
    },

    async rest(method, target, body) {
      const split = target.indexOf('?');
      const pathname = split < 0 ? target : target.slice(0, split);
      const search = split < 0 ? '' : target.slice(split);
      const prepared = policy.prepare(method, pathname, requester);
      if (!prepared.allow) return refusal(prepared.status, { ...prepared.body });
      const bytes = body === undefined ? undefined : new TextEncoder().encode(JSON.stringify(body));
      const decision = await policy.decide(prepared, { method, search, contentType: 'application/json', confirmation: undefined, body: bytes }, requester);
      if (!decision.allow) return refusal(decision.status, { ...decision.body });
      if (backend.status.state !== 'ready') return unavailable;
      const res = await sendSessionWrite(backend, method, decision.target, bytes, { headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(HERMES_ANSWER_TIMEOUT_MS) }).catch(() => undefined);
      if (!res) return unavailable;
      const answer: unknown = await res.json().catch(() => undefined);
      if (!res.ok) return { ok: false, status: res.status >= 500 ? 502 : res.status, error: { error: 'hermes-error', message: detailOf(answer, res.status) } };
      return { ok: true, result: answer };
    },
  };
}

export function mountMcpRoutes(app: Hono<AuthEnv>, deps: McpRoutesDeps): void {
  const { audit, token } = deps;

  // The owner's page: the server's registration, the tools it offers. Behind the session gate like every other `/_caduceus/api` route.
  app.get('/_caduceus/api/mcp-server', (c) => c.json(deps.info()));

  // Past the session gate and its origin check (`auth-routes.ts` leaves this prefix to the token): the caller is a program on this Mac.
  app.post(`${MCP_TOOL_ROUTE}/:name`, async (c) => {
    const source = authClient(c).source;
    // Through Tailscale Serve or from another computer, the token is not enough: the stdio server runs next to Caduceus.
    if (!isDirectLocal(c)) return c.json({ error: 'not-local', message: 'The Caduceus MCP server is only reachable from this computer.' }, 403);
    if (!token.accepts(c.req.header('authorization'))) {
      audit.record({ actor: 'anonymous', action: 'mcp.token-refused', target: 'mcp', source });
      return c.json({ error: 'bad-token', message: 'The MCP token is missing or wrong.' }, 401);
    }
    const header = c.req.header(MCP_CLIENT_HEADER) ?? '';
    const actor = `mcp:${CLIENT_NAME.test(header) ? header : 'unknown'}`;
    const tool = toolNamed(c.req.param('name'));
    if (!tool) return c.json({ error: 'unknown-tool', message: `There is no tool ${c.req.param('name')}. The tools are ${MCP_TOOLS.map(({ name }) => name).join(', ')}.` }, 404);
    const body: unknown = await c.req.json().catch(() => undefined);
    const args = isRecord(body) ? (body.arguments ?? {}) : undefined;
    const problem = argumentProblem(tool, args);
    if (problem !== undefined || !isRecord(args)) return c.json({ error: 'bad-arguments', message: problem ?? 'The arguments must be an object.' }, 400);

    const outcome = await tool.run(args, hermesCalls(deps, actor, source));
    // The policy records what changes something and what it refuses; a read changes nothing, so the call itself is the entry.
    if (outcome.ok && tool.annotations.readOnlyHint) audit.record({ actor, action: `mcp.${tool.name}`, target: typeof args.profile === 'string' ? args.profile : 'default', source, tier: 'T0', profile: typeof args.profile === 'string' ? args.profile : 'default' });
    // Every status here is one this file or Hermes's REST answer chose, all with a body.
    if (!outcome.ok) {
      // A refusal by the policy is the owner's to see: the policy audits a denial, and this names the tool and the agent behind every refusal.
      if (outcome.status === 403) audit.record({ actor, action: 'mcp.refused', target: tool.name, source, tier: typeof outcome.error.tier === 'string' ? (outcome.error.tier as Tier) : undefined });
      return c.json(outcome.error, outcome.status as ContentfulStatusCode);
    }
    return c.json({ result: outcome.result });
  });
}
