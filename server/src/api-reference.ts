// The API reference (M5 #13): every REST operation and gateway method Caduceus was built against, read from the contracts it pins and not from Hermes (whose own
// `/docs` and `/redoc` pages are never served), each with the risk tier Caduceus gives it. Pure: the route only calls it.
import { classifyGatewayMethod } from '@caduceus/contracts/policy/gateway';
import { REST_OPERATIONS } from '@caduceus/contracts/policy/rest';
import { isRecord } from '@caduceus/contracts/policy/guards';
import type { ApiReference, ApiReferenceEntry } from '@caduceus/contracts/caduceus-api';
import type { HermesContracts } from './hermes-contract.ts';

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'patch'] as const;

const byOrder = (a: ApiReferenceEntry, b: ApiReferenceEntry) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name) || a.method.localeCompare(b.method);

export function apiReference(pinned: HermesContracts): ApiReference {
  const rest: ApiReferenceEntry[] = [];
  for (const [path, item] of Object.entries(pinned.rest.paths)) {
    for (const method of HTTP_METHODS) {
      const operation: unknown = item[method];
      if (!isRecord(operation)) continue;
      const policy = REST_OPERATIONS[`${method.toUpperCase()} ${path}`];
      const tags = Array.isArray(operation.tags) ? operation.tags : [];
      rest.push({
        kind: 'rest',
        method: method.toUpperCase(),
        name: path,
        group: typeof tags[0] === 'string' ? tags[0] : 'other',
        summary: typeof operation.summary === 'string' ? operation.summary : '',
        // An operation the policy map does not know is denied: the map is where Caduceus decides.
        tier: policy?.tier ?? 'denied',
        read: policy?.read ?? false,
      });
    }
  }
  const gateway: ApiReferenceEntry[] = pinned.gateway.methods.map((entry) => {
    const classified = classifyGatewayMethod(entry.name, {});
    const dot = entry.name.indexOf('.');
    return {
      kind: 'gateway',
      method: 'RPC',
      name: entry.name,
      group: dot > 0 ? entry.name.slice(0, dot) : 'gateway',
      summary: entry.summary ?? '',
      tier: classified.ok ? classified.policy.tier : 'denied',
      read: classified.ok ? classified.policy.read : false,
      params: entry.params.map((param) => param.name),
    };
  });
  return { version: pinned.version, rest: rest.sort(byOrder), gateway: gateway.sort(byOrder) };
}
