// The policy proxy's decisions: every Hermes REST request (and, from M0 #09, every gateway frame) is classified by the
// policy map (`contracts/policy/`) and then allowed, or refused with a body the web app can show.
import type { PolicyRefusal, StepUpRequired } from '@caduceus/contracts/caduceus-api';
import { flattenConfig } from '@caduceus/contracts/config-keys';
import { isRecord } from '@caduceus/contracts/policy/guards';
import { createRestClassifier, lacksExplicitProfile, lowerInWorkspace, profileOf, resolveTier, type FilePathSource, type RequestFacts, type RestMatch } from '@caduceus/contracts/policy/rest';
import { DENIED_MESSAGES, PROFILE_REQUIRED_MESSAGE, type DeniedReason, type Policy, type Tier } from '@caduceus/contracts/policy/tiers';
import crypto from 'node:crypto';
import type { AuditLog } from './audit-log.ts';
import type { Confirmations } from './confirmations.ts';
import type { FileGuard } from './file-guard.ts';
import type { OwnerAuth } from './owner-auth.ts';
import type { ReadOnlyMode } from './read-only.ts';

/** What the owner is told when read-only mode refuses something. */
export const READ_ONLY_MESSAGE = 'Read-only mode is on: Caduceus is not changing anything in Hermes.';

/** A body a request may carry unless its operation takes uploads. */
export const BODY_LIMIT_BYTES = 1024 * 1024;
/** The body of an upload (a file as base64 in JSON, or a multipart form): Hermes caps managed files at 100 MiB. */
export const UPLOAD_LIMIT_BYTES = 160 * 1024 * 1024;

export interface PolicyDeps {
  audit: AuditLog;
  auth: OwnerAuth;
  readOnly: ReadOnlyMode;
  confirmations: Confirmations;
  files: FileGuard;
  /** Operations beyond the pinned contract, with their policy (the routes a test's stand-in Hermes answers, say). */
  extraRoutes?: Readonly<Record<string, Policy>>;
}

/** Who is asking: the session (for step-up), and where from (for the audit log). */
export interface Requester {
  /** The id of the owner's session; `undefined` on a path that needs none. */
  sessionId?: string;
  /** Where the request came from, as the audit log names it (see `AuditEntry.source`). */
  source: string;
  /** Who is acting, as the audit log names them; the owner when left out. The MCP server's calls are `mcp:<client>` (M4 #11). */
  actor?: string;
}

/** A refusal: the HTTP status and the JSON body to answer with. */
export interface Refused {
  allow: false;
  status: 400 | 403 | 413;
  body: PolicyRefusal | StepUpRequired;
}

/** What the browser sent besides the path. */
export interface RestRequest {
  method: string;
  /** The query string with its `?`, or an empty string. */
  search: string;
  contentType: string | undefined;
  /** The typed confirmation token the request carries (`X-Caduceus-Confirmation`), if any. */
  confirmation: string | undefined;
  body: Uint8Array<ArrayBuffer> | undefined;
}

/** The request is allowed; this is the path (and query) to forward to Hermes. */
export interface Allowed {
  allow: true;
  target: string;
  /** What the request turned out to cost, after the file guard and the workspaces: the tier it was judged at. */
  tier: Tier;
}

/** A request the policy classified and did not deny outright: read its body (up to `maxBodyBytes`), then `decide`. */
export interface Prepared {
  allow: true;
  match: Extract<RestMatch, { ok: true }>;
  maxBodyBytes: number;
}

export interface RestPolicy {
  /** Classifies a request line, refusing what is denied whatever its body says. */
  prepare(method: string, rawPath: string, requester: Requester): Prepared | Refused;
  /** Decides a classified request from what it says and who sends it. */
  decide(prepared: Prepared, request: RestRequest, requester: Requester): Promise<Allowed | Refused>;
  /**
   * The request line a typed confirmation is bound to, for a method and a path with its query: `METHOD /canonical/path?query`.
   * `undefined` when the policy would not forward the request at all, so there is nothing to confirm.
   */
  requestLine(method: string, rawTarget: string): string | undefined;
}

const CONFIRMATION_MESSAGES = {
  required: 'This action needs you to type the name of what it changes.',
  invalid: 'This confirmation was for something else, or was already used. Confirm again.',
  expired: 'This confirmation expired. Confirm again.',
} as const;

/**
 * The JSON body of a request, as Hermes will read it: `{}` for none, `undefined` for a body Caduceus cannot read as JSON.
 * A request with no `Content-Type` is read as JSON, because that is how it is forwarded.
 */
function jsonObject(request: RestRequest): Record<string, unknown> | undefined {
  if (!request.body || request.body.length === 0) return {};
  const contentType = request.contentType?.toLowerCase();
  if (contentType && !contentType.includes('json')) return {};
  try {
    const parsed: unknown = JSON.parse(Buffer.from(request.body).toString('utf8'));
    return isRecord(parsed) ? parsed : {};
  } catch {
    return undefined;
  }
}

/** The value(s) of the file path a request names, for the file guard: every one of them if it is given more than once. */
async function filePathsOf(source: FilePathSource, facts: RequestFacts, request: RestRequest): Promise<string[] | 'unreadable'> {
  if (source.in === 'query') return facts.query.getAll(source.field);
  if (source.in === 'body') {
    const value = facts.body?.[source.field];
    return value === undefined ? [] : typeof value === 'string' ? [value] : 'unreadable';
  }
  try {
    const form = await new Response(request.body, { headers: { 'content-type': request.contentType ?? '' } }).formData();
    return form.getAll(source.field).map((value) => (typeof value === 'string' ? value : '\0'));
  } catch {
    return 'unreadable';
  }
}

/** How many keys of a config save the audit entry names before it says how many more there were. */
const AUDIT_KEYS_LISTED = 40;

/** The body field that names what a credential operation works on: a variable or a provider is a name, never the value beside it. */
const NAMED_BY: Readonly<Record<string, string>> = {
  'PUT /api/env': 'key',
  'DELETE /api/env': 'key',
  'POST /api/env/reveal': 'key',
  'POST /_caduceus/api/keys/test': 'key',
  'POST /api/credentials/pool': 'provider',
  'POST /api/providers/custom-endpoints': 'name',
  'PUT /_caduceus/api/work/scripts': 'name',
};
/** A name in an audit entry is a variable or a provider, so a longer one is not one. */
const MAX_NAMED = 80;

/**
 * What an audit entry says a request was for. A config save names the keys it sets (`/api/config (agent.max_turns, display.compact)`)
 * and never their values: a value can be a credential, a key is only a name. A credential operation names its variable or provider
 * (`/api/env (OPENROUTER_API_KEY)`) and never the secret that travels with it.
 */
function auditTarget(operation: string, pathname: string, body: Record<string, unknown> | undefined): string {
  const field = NAMED_BY[operation];
  if (field) {
    const name = body?.[field];
    return typeof name === 'string' && name !== '' && name.length <= MAX_NAMED ? `${pathname} (${name})` : pathname;
  }
  if (operation !== 'PUT /api/config') return pathname;
  const keys = [...flattenConfig(body?.config).keys()];
  if (keys.length === 0) return pathname;
  const listed = keys.slice(0, AUDIT_KEYS_LISTED).join(', ');
  return `${pathname} (${listed}${keys.length > AUDIT_KEYS_LISTED ? `, and ${keys.length - AUDIT_KEYS_LISTED} more` : ''})`;
}

export function createPolicy({ audit, auth, readOnly, confirmations, files, extraRoutes }: PolicyDeps): RestPolicy {
  const classify = createRestClassifier(extraRoutes);

  const refuse = (method: string, pathname: string | undefined, reason: DeniedReason, requester: Requester, operation?: string): Refused => {
    audit.record({ actor: requester.actor ?? 'owner', action: 'policy.denied', target: `${method} ${pathname ?? '(invalid path)'}`, source: requester.source, tier: 'denied' });
    const refusal: PolicyRefusal = { error: 'denied', tier: 'denied', ...(operation ? { operation } : {}), reason, message: DENIED_MESSAGES[reason] };
    return { allow: false, status: 403, body: refusal };
  };

  return {
    requestLine(method, rawTarget) {
      const split = rawTarget.indexOf('?');
      const match = classify(method, split < 0 ? rawTarget : rawTarget.slice(0, split));
      if (!match.ok || match.policy.tier === 'denied') return undefined;
      return `${method.toUpperCase()} ${match.pathname}${split < 0 ? '' : rawTarget.slice(split)}`;
    },

    prepare(method, rawPath, requester) {
      const match = classify(method, rawPath);
      if (!match.ok) return refuse(method, match.pathname, match.reason, requester);
      if (match.policy.tier === 'denied') return refuse(method, match.pathname, match.policy.reason ?? 'not-proxied', requester, match.operation);
      return { allow: true, match, maxBodyBytes: match.policy.upload ? UPLOAD_LIMIT_BYTES : BODY_LIMIT_BYTES };
    },

    async decide({ match }, request, requester) {
      const body = jsonObject(request);
      // What the tier or the file guard reads from the body must be read as Hermes will read it. A body Hermes might accept
      // and Caduceus cannot parse (JSON with NaN) is refused for those operations, not waved through at the base tier.
      const sources = match.policy.filePath === undefined ? [] : ([] as FilePathSource[]).concat(match.policy.filePath);
      if (body === undefined && (match.policy.refine || sources.some((source) => source.in === 'body'))) return refuse(request.method, match.pathname, 'bad-body', requester, match.operation);
      const facts: RequestFacts = { query: new URLSearchParams(request.search), body };
      let policy = resolveTier(match, facts);
      if (sources.length > 0) {
        let inWorkspace = true;
        for (const source of sources) {
          const paths = await filePathsOf(source, facts, request);
          if (paths === 'unreadable') return refuse(request.method, match.pathname, 'bad-path', requester, match.operation);
          inWorkspace &&= paths.length > 0;
          for (const raw of paths) {
            const check = files.check(raw, source.access);
            if (!check.ok) return refuse(request.method, match.pathname, check.reason, requester, match.operation);
            inWorkspace &&= check.inWorkspace;
          }
        }
        // A write whose every file is inside a workspace Caduceus knows costs less (architecture §5); anywhere else it stays a T3.
        if (inWorkspace) policy = lowerInWorkspace(match.operation, policy, facts);
      }
      // Read-only mode lets only reads through, and no T3 action (a read that discloses secrets included). It is checked
      // first, so nobody is asked for a passkey for something that cannot happen.
      if (readOnly.enabled() && (!policy.read || policy.tier === 'T3')) {
        return { allow: false, status: 403, body: { error: 'read-only', tier: policy.tier, operation: match.operation, message: READ_ONLY_MESSAGE } };
      }
      if (lacksExplicitProfile(match, facts)) {
        return { allow: false, status: 400, body: { error: 'profile-required', tier: policy.tier, operation: match.operation, message: PROFILE_REQUIRED_MESSAGE } };
      }
      if ((policy.tier === 'T2' || policy.tier === 'T3') && !(requester.sessionId && auth.hasStepUp(requester.sessionId))) {
        const required: StepUpRequired = { error: 'step-up-required', tier: policy.tier, operation: match.operation };
        return { allow: false, status: 403, body: required };
      }
      if (policy.tier === 'T3') {
        const check = confirmations.consume(request.confirmation, {
          sessionId: requester.sessionId!,
          operation: `${request.method.toUpperCase()} ${match.pathname}${request.search}`,
          bodySha256: () => crypto.createHash('sha256').update(request.body ?? '').digest('hex'),
        });
        if (!check.ok) {
          if (check.reason !== 'required') audit.record({ actor: requester.actor ?? 'owner', action: 'policy.refused', target: match.pathname, source: requester.source, tier: 'T3' });
          return { allow: false, status: 403, body: { error: `confirmation-${check.reason}`, tier: 'T3', operation: match.operation, message: CONFIRMATION_MESSAGES[check.reason] } };
        }
      }
      if (policy.tier !== 'T0') {
        audit.record({ actor: requester.actor ?? 'owner', action: match.operation, target: auditTarget(match.operation, match.pathname, body), source: requester.source, tier: policy.tier, profile: profileOf(match, facts) ?? undefined });
      }
      return { allow: true, target: match.pathname + request.search, tier: policy.tier };
    },
  };
}

export type { Tier };
