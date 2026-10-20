// The policy of the live gateway connection: the hook the browser WebSocket proxy (M0 #09) calls for every frame, in both
// directions. It classifies a method call, a server→client request or an event by the policy map
// (`contracts/policy/gateway.ts`), then forwards the frame, drops it, or answers the sender with an error the UI can show.
//
// One `GatewayFrames` per browser connection, because answering a server→client request is judged by the request it answers
// (an approval, or a secret?), and only the connection saw that request go by.
import type { PolicyRefusal, StepUpRequired } from '@caduceus/contracts/caduceus-api';
import {
  classifyGatewayMethod,
  GATEWAY_EVENTS,
  SERVER_REQUESTS,
  slashInvocation,
  type Params,
} from '@caduceus/contracts/policy/gateway';
import { isRecord } from '@caduceus/contracts/policy/guards';
import { DENIED_MESSAGES, stricter, type DeniedReason, type Policy, type Tier } from '@caduceus/contracts/policy/tiers';
import type { AuditLog } from './audit-log.ts';
import type { Confirmations } from './confirmations.ts';
import { READ_ONLY_MESSAGE } from './policy.ts';
import type { ReadOnlyMode } from './read-only.ts';

/** The JSON-RPC error code of a refusal by the policy (the range -32000 to -32099 is for the server's own errors). */
export const POLICY_ERROR_CODE = -32001;

/** The JSON-RPC error code for a frame that is not a valid request. */
const INVALID_REQUEST_CODE = -32600;

/** How many unanswered server→client requests one connection remembers. */
const MAX_OPEN_REQUESTS = 256;

export interface GatewayPolicyDeps {
  audit: AuditLog;
  confirmations: Confirmations;
  readOnly: Pick<ReadOnlyMode, 'enabled'>;
  /** Whether the owner's session holds a live step-up grant. */
  hasStepUp(sessionId: string): boolean;
  /**
   * The names (lower case) of the exec-type quick commands in every profile's config: Hermes runs those as shell
   * commands, so `command.dispatch` and `slash.exec` of one is denied.
   */
  execQuickCommands(): Promise<ReadonlySet<string>>;
  /** While it is draining (M5 #12), a call that starts a turn is refused: Hermes or Caduceus is about to stop. */
  drain?: { active(): boolean };
}

/** The gateway methods that start a turn. */
const TURN_STARTS: Record<string, true> = { 'prompt.submit': true, 'prompt.background': true, 'prompt.btw': true };

const DRAINING_MESSAGE = 'Caduceus is updating or restarting, so new turns are paused. Try again in a moment.';

/** Who is on the other end of the browser's connection. */
export interface GatewayConnection {
  /** The id of the owner's session the WebSocket was opened with. */
  sessionId: string;
  /** Where the connection came from, as the audit log names it. */
  source: string;
  /** Who is on the other end, as the audit log names them; the owner when left out. The MCP server's calls are `mcp:<client>` (M4 #11). */
  actor?: string;
}

/** What to do with a frame: pass `forward` on to its destination, and send `reply` back to whoever sent the frame. */
export interface FrameVerdict {
  forward?: string;
  reply?: string;
}

export interface GatewayFrames {
  /** A frame from the browser, on its way to Hermes. */
  fromBrowser(text: string): Promise<FrameVerdict>;
  /** A frame from Hermes, on its way to the browser. */
  fromHermes(text: string): FrameVerdict;
}

export interface GatewayPolicy {
  /** The policy for one browser connection. */
  connect(connection: GatewayConnection): GatewayFrames;
}

type Frame = Record<string, unknown>;

const isId = (value: unknown): value is string | number => typeof value === 'string' || typeof value === 'number';

const CONFIRMATION_MESSAGES = {
  required: 'This action needs you to type the name of what it changes.',
  invalid: 'This confirmation was for something else, or was already used. Confirm again.',
  expired: 'This confirmation expired. Confirm again.',
} as const;

const STEP_UP_MESSAGE = 'This needs a fresh passkey confirmation.';

export function createGatewayPolicy({ audit, confirmations, readOnly, hasStepUp, execQuickCommands, drain }: GatewayPolicyDeps): GatewayPolicy {
  return {
    connect({ sessionId, source, actor = 'owner' }) {
      // Server→client requests Hermes has sent this browser and it has not answered: id → method.
      const open = new Map<string, string>();
      const remember = (id: string, method: string) => {
        while (open.size >= MAX_OPEN_REQUESTS) open.delete(open.keys().next().value!);
        open.set(id, method);
      };

      /** A refusal as the sender of the frame is told: an error response when the frame had an id, else a notification. */
      const refusalFrame = (refusal: PolicyRefusal | StepUpRequired & { message: string }, id: string | number | null | undefined): string =>
        JSON.stringify(
          id === undefined
            ? { jsonrpc: '2.0', method: 'caduceus.refused', params: refusal }
            : { jsonrpc: '2.0', id, error: { code: POLICY_ERROR_CODE, message: refusal.message, data: refusal } },
        );

      const denied = (operation: string, reason: DeniedReason, id: string | number | null | undefined): FrameVerdict => {
        audit.record({ actor, action: 'policy.denied', target: operation, source, tier: 'denied' });
        return { reply: refusalFrame({ error: 'denied', tier: 'denied', operation, reason, message: DENIED_MESSAGES[reason] }, id) };
      };

      const stepUpRequired = (operation: string, tier: Tier, id: string | number | null | undefined): FrameVerdict => ({
        reply: refusalFrame({ error: 'step-up-required', tier, operation, message: STEP_UP_MESSAGE }, id),
      });

      /** The checks every action that needs a tier goes through, in order. `undefined` when it may go ahead. */
      const gate = (operation: string, policy: Policy, id: string | number | undefined, confirmation: unknown): FrameVerdict | undefined => {
        if (readOnly.enabled() && (!policy.read || policy.tier === 'T3')) {
          return { reply: refusalFrame({ error: 'read-only', tier: policy.tier, operation, message: READ_ONLY_MESSAGE }, id) };
        }
        if ((policy.tier === 'T2' || policy.tier === 'T3') && !hasStepUp(sessionId)) return stepUpRequired(operation, policy.tier, id);
        if (policy.tier === 'T3') {
          const check = confirmations.consume(typeof confirmation === 'string' ? confirmation : undefined, { sessionId, operation, bodySha256: () => '' });
          if (!check.ok) {
            if (check.reason !== 'required') audit.record({ actor, action: 'policy.refused', target: operation, source, tier: 'T3' });
            const refusal: PolicyRefusal = { error: `confirmation-${check.reason}`, tier: 'T3', operation, message: CONFIRMATION_MESSAGES[check.reason] };
            return { reply: refusalFrame(refusal, id) };
          }
        }
        return undefined;
      };

      /** The tier of answering the server→client request `id` with `result`: known requests by their kind, strangers T2. */
      const answerPolicy = (id: string, result: Params): { method: string; policy: Policy } => {
        const method = open.get(id);
        const request = method === undefined ? undefined : SERVER_REQUESTS[method];
        if (method === undefined || !request) return { method: 'answer', policy: { tier: 'T2', read: false } };
        const refined = request.answer?.(result);
        if (refined === undefined) return { method, policy: { tier: request.tier, read: false } };
        return { method, policy: typeof refined === 'string' ? { tier: stricter(request.tier, refined), read: false } : { tier: stricter(request.tier, refined.tier), read: refined.read } };
      };

      const call = async (frame: Frame, method: string, text: string): Promise<FrameVerdict> => {
        const id = isId(frame.id) ? frame.id : undefined;
        const params = isRecord(frame.params) ? frame.params : {};
        const operation = `rpc ${method}`;
        const classified = classifyGatewayMethod(method, params);
        if (!classified.ok) return denied(operation, classified.reason, id);
        let policy = classified.policy;
        if (drain?.active() && TURN_STARTS[method]) return { reply: refusalFrame({ error: 'draining', tier: policy.tier, operation, message: DRAINING_MESSAGE }, id) };
        if (method === 'command.dispatch' || method === 'slash.exec') {
          const execNames = await execQuickCommands().catch(() => undefined);
          if (!execNames) return denied(operation, 'exec-unverified', id);
          const invocation = slashInvocation(method, params);
          // Hermes looks a quick command up by the typed name (`command.dispatch`, which keeps its case) or by the built-in's name an alias resolves to.
          if (execNames.has(invocation.name) || execNames.has(invocation.canonical)) return denied(operation, 'exec-quick-command', id);
        }
        if (method === 'request.answer') {
          const answered = answerPolicy(String(params.id), isRecord(params.result) ? params.result : {});
          policy = { tier: stricter(policy.tier, answered.policy.tier), read: answered.policy.read };
        }
        const caduceus = isRecord(frame.caduceus) ? frame.caduceus : undefined;
        const refused = gate(operation, policy, id, caduceus?.confirmation);
        if (refused) return refused;
        if (policy.tier !== 'T0') {
          audit.record({
            actor,
            action: operation,
            target: typeof params.session_id === 'string' ? `session:${params.session_id}` : 'gateway',
            source,
            tier: policy.tier,
            profile: typeof params.profile === 'string' && params.profile ? params.profile : undefined,
          });
        }
        if (!('caduceus' in frame)) return { forward: text };
        // The confirmation is Caduceus's, not Hermes's: it never leaves this process.
        const { caduceus: _confirmation, ...rest } = frame;
        return { forward: JSON.stringify(rest) };
      };

      const answer = (frame: Frame, id: string | number, text: string): FrameVerdict => {
        // An error answer hands the agent nothing ("not supported", say), so it is never held back.
        if ('error' in frame) {
          open.delete(String(id));
          return { forward: text };
        }
        const { method, policy } = answerPolicy(String(id), isRecord(frame.result) ? frame.result : {});
        const operation = `rpc ${method}`;
        const refused = gate(operation, policy, undefined, undefined);
        if (refused) return refused;
        if (policy.tier !== 'T0') audit.record({ actor, action: operation, target: `request:${id}`, source, tier: policy.tier });
        open.delete(String(id));
        return { forward: text };
      };

      return {
        async fromBrowser(text) {
          let frame: unknown;
          try {
            frame = JSON.parse(text);
          } catch {
            frame = undefined;
          }
          if (!isRecord(frame)) return { reply: invalidFrame(null) };
          const id = isId(frame.id) ? frame.id : undefined;
          if (typeof frame.method === 'string') return call(frame, frame.method, text);
          if (id !== undefined && ('result' in frame || 'error' in frame)) return answer(frame, id, text);
          return { reply: invalidFrame(id ?? null) };
        },

        fromHermes(text) {
          let frame: unknown;
          try {
            frame = JSON.parse(text);
          } catch {
            return { forward: text };
          }
          if (!isRecord(frame)) return { forward: text };
          const params = isRecord(frame.params) ? frame.params : {};
          if (frame.method === 'event') {
            const type = typeof params.type === 'string' ? params.type : '';
            const event = Object.hasOwn(GATEWAY_EVENTS, type) ? GATEWAY_EVENTS[type] : undefined;
            if (!event?.deliver) return {};
            if (type === 'request.cancel' && isRecord(params.payload) && typeof params.payload.id === 'string') open.delete(params.payload.id);
            return { forward: text };
          }
          if (typeof frame.method === 'string' && typeof frame.id === 'string') {
            const request = Object.hasOwn(SERVER_REQUESTS, frame.method) ? SERVER_REQUESTS[frame.method] : undefined;
            if (!request?.deliver) {
              // Hermes is told it is declined, so the agent does not wait for an answer that cannot come.
              return { reply: denied(`rpc ${frame.method}`, request?.reason ?? 'unclassified', frame.id).reply };
            }
            remember(frame.id, frame.method);
            return { forward: text };
          }
          // A result that carries the requests a resumed session still has open: the browser will answer them.
          if (isRecord(frame.result) && Array.isArray(frame.result.open_requests)) {
            for (const entry of frame.result.open_requests) {
              if (isRecord(entry) && typeof entry.id === 'string' && typeof entry.method === 'string' && SERVER_REQUESTS[entry.method]?.deliver) remember(entry.id, entry.method);
            }
          }
          return { forward: text };
        },
      };
    },
  };
}

const invalidFrame = (id: string | number | null): string =>
  JSON.stringify({
    jsonrpc: '2.0',
    id,
    error: {
      code: INVALID_REQUEST_CODE,
      message: DENIED_MESSAGES['bad-frame'],
      data: { error: 'denied', tier: 'denied', reason: 'bad-frame', message: DENIED_MESSAGES['bad-frame'] } satisfies PolicyRefusal,
    },
  });
