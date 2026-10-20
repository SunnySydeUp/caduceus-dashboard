// Compares two versions of Hermes's contracts: REST (OpenAPI), gateway (OpenRPC) and the gateway's capability markers.
import type { ContractChanges, GatewayMarkers } from '@caduceus/contracts/caduceus-api';

type Schemas = Record<string, unknown>;

export interface OpenApiOperation {
  parameters?: unknown;
  requestBody?: unknown;
  responses?: unknown;
  [doc: string]: unknown;
}

/** The parts of an OpenAPI 3 document the diff reads. Path-item keys other than HTTP methods are ignored. */
export interface OpenApiDocument {
  info?: { version?: string };
  paths: Record<string, Record<string, OpenApiOperation>>;
  components?: { schemas?: Schemas };
}

export interface OpenRpcEntry {
  name: string;
  summary?: string;
  params: { name: string; schema: unknown }[];
  result?: { name: string; schema: unknown };
}

/** The parts of Hermes's OpenRPC gateway contract the diff reads (methods, server→client requests, events). */
export interface OpenRpcDocument {
  methods: OpenRpcEntry[];
  'x-server-requests'?: OpenRpcEntry[];
  'x-notifications'?: OpenRpcEntry[];
  components?: { schemas?: Schemas };
}

/** Keys that only document a schema or operation; editing them changes nothing a client sends or receives. */
const DOC_KEYS: Record<string, true> = {
  description: true,
  summary: true,
  title: true,
  operationId: true,
  tags: true,
  example: true,
  examples: true,
};
const HTTP_METHODS: Record<string, true> = {
  get: true,
  put: true,
  post: true,
  delete: true,
  options: true,
  head: true,
  patch: true,
  trace: true,
};

export function diffRestContracts(pinned: OpenApiDocument, live: OpenApiDocument): ContractChanges {
  return diffEntries(restOperations(pinned), restOperations(live));
}

export function diffGatewayContracts(pinned: OpenRpcDocument, live: OpenRpcDocument): ContractChanges {
  return diffEntries(gatewayEntries(pinned), gatewayEntries(live));
}

/** Markers the live gateway lost or changed. New capabilities are fine; an unobserved desktop contract is not a mismatch. */
export function markerMismatches(pinned: GatewayMarkers, live: GatewayMarkers): string[] {
  const mismatches: string[] = [];
  const flags = [
    ['replay epoch', 'replayEpoch'],
    ['heartbeat', 'heartbeat'],
    ['change events', 'changeEvents'],
  ] as const;
  for (const [label, key] of flags) {
    if (pinned[key] !== live[key]) mismatches.push(`${label}: pinned ${pinned[key]}, live ${live[key]}`);
  }
  for (const [name, value] of Object.entries(pinned.capabilities)) {
    const liveValue = name in live.capabilities ? JSON.stringify(live.capabilities[name]) : 'missing';
    if (liveValue !== JSON.stringify(value)) {
      mismatches.push(`gateway.capabilities ${name}: pinned ${JSON.stringify(value)}, live ${liveValue}`);
    }
  }
  if (live.desktopContract !== null && live.desktopContract !== pinned.desktopContract) {
    mismatches.push(`desktop contract: pinned ${pinned.desktopContract}, live ${live.desktopContract}`);
  }
  return mismatches;
}

/**
 * What differs between the pinned contracts and the running Hermes, in the words of a compatibility report: removals,
 * changes and lost or changed markers. Additions are no difference, and neither is whatever could not be read.
 */
export function contractDrift({ rest, gateway, markers }: { rest: ContractChanges; gateway: ContractChanges; markers: { pinned: GatewayMarkers; live: GatewayMarkers | null } }): string[] {
  return [
    ...rest.removed.map((name) => `REST removed: ${name}`),
    ...rest.changed.map((name) => `REST changed: ${name}`),
    ...gateway.removed.map((name) => `Gateway removed: ${name}`),
    ...gateway.changed.map((name) => `Gateway changed: ${name}`),
    ...(markers.live ? markerMismatches(markers.pinned, markers.live) : []).map((mismatch) => `Gateway marker changed: ${mismatch}`),
  ];
}

/** Each entry's comparable parts, as canonical JSON, keyed by entry name. */
type Entries = Map<string, Record<string, string>>;

function restOperations(doc: OpenApiDocument): Entries {
  const schemas = doc.components?.schemas ?? {};
  const entries: Entries = new Map();
  for (const [path, item] of Object.entries(doc.paths)) {
    for (const [method, operation] of Object.entries(item)) {
      if (!HTTP_METHODS[method]) continue;
      entries.set(`${method.toUpperCase()} ${path}`, {
        parameters: canonical(operation.parameters, schemas),
        requestBody: canonical(operation.requestBody, schemas),
        responses: canonical(operation.responses, schemas),
      });
    }
  }
  return entries;
}

function gatewayEntries(doc: OpenRpcDocument): Entries {
  const schemas = doc.components?.schemas ?? {};
  const entries: Entries = new Map();
  const kinds = [
    ['method', doc.methods],
    ['server request', doc['x-server-requests'] ?? []],
    ['event', doc['x-notifications'] ?? []],
  ] as const;
  for (const [kind, list] of kinds) {
    for (const entry of list) {
      const parts: Record<string, string> = {};
      for (const param of entry.params) parts[param.name] = canonical(param.schema, schemas);
      if (entry.result) parts[entry.result.name] = canonical(entry.result.schema, schemas);
      entries.set(`${kind} ${entry.name}`, parts);
    }
  }
  return entries;
}

function diffEntries(pinned: Entries, live: Entries): ContractChanges {
  const added = [...live.keys()].filter((name) => !pinned.has(name));
  const removed = [...pinned.keys()].filter((name) => !live.has(name));
  const changed: string[] = [];
  for (const [name, pinnedParts] of pinned) {
    const liveParts = live.get(name);
    if (!liveParts) continue;
    const parts = [...new Set([...Object.keys(pinnedParts), ...Object.keys(liveParts)])];
    const differing = parts.filter((part) => pinnedParts[part] !== liveParts[part]);
    if (differing.length) changed.push(`${name} (${differing.join(', ')})`);
  }
  return { added: added.sort(), removed: removed.sort(), changed: changed.sort() };
}

/** JSON with `$ref`s inlined (a cycle stays a named ref), documentation keys dropped and object keys sorted. */
function canonical(node: unknown, schemas: Schemas): string {
  return JSON.stringify(resolve(node, schemas, []));
}

function resolve(node: unknown, schemas: Schemas, refChain: string[]): unknown {
  if (Array.isArray(node)) return node.map((item) => resolve(item, schemas, refChain));
  if (typeof node !== 'object' || node === null) return node;
  if ('$ref' in node && typeof node.$ref === 'string') {
    const name = node.$ref.slice(node.$ref.lastIndexOf('/') + 1);
    if (refChain.includes(name)) return { $ref: name };
    return resolve(schemas[name] ?? { unresolved: name }, schemas, [...refChain, name]);
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node).sort(([a], [b]) => a.localeCompare(b))) {
    if (DOC_KEYS[key]) continue;
    // `properties` maps field names to schemas: its keys are data, never documentation.
    out[key] =
      key === 'properties' && typeof value === 'object' && value !== null
        ? Object.fromEntries(
            Object.entries(value)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([field, schema]) => [field, resolve(schema, schemas, refChain)]),
          )
        : resolve(value, schemas, refChain);
  }
  return out;
}
