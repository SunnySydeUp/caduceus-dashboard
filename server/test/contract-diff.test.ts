import { describe, expect, test } from 'vitest';
import type { GatewayMarkers } from '@caduceus/contracts/caduceus-api';
import {
  diffGatewayContracts,
  diffRestContracts,
  markerMismatches,
  type OpenApiDocument,
  type OpenRpcDocument,
} from '../src/contract-diff.ts';

interface RestVariant {
  statusSummary?: string;
  statusOperationId?: string;
  profileParamType?: string;
  profileCreateTitle?: string;
  profileCreateProperties?: Record<string, unknown>;
}

/** A small OpenAPI document shaped like FastAPI's output for Hermes. */
function restDoc(variant: RestVariant = {}): OpenApiDocument {
  return {
    paths: {
      '/api/status': {
        get: {
          summary: variant.statusSummary ?? 'Get Status',
          operationId: variant.statusOperationId ?? 'get_status_api_status_get',
          parameters: [
            { name: 'profile', in: 'query', required: false, schema: { type: variant.profileParamType ?? 'string', title: 'Profile' } },
          ],
          responses: { '200': { description: 'Successful Response', content: { 'application/json': { schema: {} } } } },
        },
      },
      '/api/profiles': {
        post: {
          requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/ProfileCreate' } } } },
          responses: { '200': { description: 'Successful Response' } },
        },
      },
      '/api/sessions/{session_id}': {
        delete: { parameters: [{ name: 'session_id', in: 'path', required: true, schema: { type: 'string' } }], responses: {} },
      },
    },
    components: {
      schemas: {
        ProfileCreate: {
          title: variant.profileCreateTitle ?? 'ProfileCreate',
          type: 'object',
          properties: variant.profileCreateProperties ?? { name: { type: 'string', title: 'Name' }, title: { type: 'string' } },
          required: ['name'],
        },
      },
    },
  };
}

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });

/** A small OpenRPC document shaped like Hermes's `gateway-contract.openrpc.json`. */
function gatewayDoc(): OpenRpcDocument {
  return {
    methods: [
      { name: 'ping', summary: 'Cheapest liveness probe.', params: [{ name: 'params', schema: ref('Empty') }], result: { name: 'result', schema: ref('PingResult') } },
      { name: 'session.create', summary: 'Create a session.', params: [{ name: 'params', schema: ref('SessionCreateParams') }], result: { name: 'result', schema: ref('Empty') } },
    ],
    'x-server-requests': [
      { name: 'approval', summary: 'Ask the user.', params: [{ name: 'params', schema: ref('Empty') }], result: { name: 'result', schema: ref('Empty') } },
    ],
    'x-notifications': [{ name: 'message.delta', summary: 'Streamed text.', params: [{ name: 'payload', schema: ref('Delta') }] }],
    components: {
      schemas: {
        Empty: { type: 'object', additionalProperties: false },
        PingResult: { type: 'object', properties: { pong: { type: 'boolean' } }, required: ['pong'] },
        SessionCreateParams: { type: 'object', properties: { source: { type: 'string' }, parent: ref('SessionCreateParams') } },
        Delta: { type: 'object', properties: { text: { type: 'string' } } },
      },
    },
  };
}

const markers: GatewayMarkers = {
  replayEpoch: true,
  heartbeat: true,
  changeEvents: true,
  capabilities: { per_session_exclusive_submit: true },
  desktopContract: 7,
};

const noChanges = { added: [], removed: [], changed: [] };

describe('REST contract diff', () => {
  test('finds no changes between identical contracts', () => {
    expect(diffRestContracts(restDoc(), restDoc())).toEqual(noChanges);
  });

  test('names added, removed and changed operations by method and path', () => {
    const live = restDoc({ profileParamType: 'integer' });
    delete live.paths['/api/sessions/{session_id}'];
    live.paths['/api/cron/jobs'] = { get: { responses: {} } };

    expect(diffRestContracts(restDoc(), live)).toEqual({
      added: ['GET /api/cron/jobs'],
      removed: ['DELETE /api/sessions/{session_id}'],
      changed: ['GET /api/status (parameters)'],
    });
  });

  test('sees a change inside a referenced schema as a change to the operation that uses it', () => {
    const live = restDoc({ profileCreateProperties: { name: { type: 'integer', title: 'Name' }, title: { type: 'string' } } });

    expect(diffRestContracts(restDoc(), live).changed).toEqual(['POST /api/profiles (requestBody)']);
  });

  test('ignores documentation-only edits but not a property that happens to be called "title"', () => {
    const docsOnly = restDoc({ statusSummary: 'Machine status', statusOperationId: 'renamed_handler', profileCreateTitle: 'Renamed' });
    const titleRemoved = restDoc({ profileCreateProperties: { name: { type: 'string', title: 'Name' } } });

    expect(diffRestContracts(restDoc(), docsOnly)).toEqual(noChanges);
    expect(diffRestContracts(restDoc(), titleRemoved).changed).toEqual(['POST /api/profiles (requestBody)']);
  });
});

describe('gateway contract diff', () => {
  test('finds no changes between identical contracts, including self-referencing schemas', () => {
    expect(diffGatewayContracts(gatewayDoc(), gatewayDoc())).toEqual(noChanges);
  });

  test('names added, removed and changed methods, server requests and events', () => {
    const live = gatewayDoc();
    live.methods = live.methods.filter((m) => m.name !== 'ping');
    live.methods.push({ name: 'session.steer', params: [], result: { name: 'result', schema: {} } });
    live['x-server-requests'] = [];
    live.components = {
      schemas: {
        ...live.components?.schemas,
        SessionCreateParams: { type: 'object', properties: { source: { type: 'integer' } } },
        Delta: { type: 'object', properties: { text: { type: 'string' }, seq: { type: 'integer' } } },
      },
    };

    expect(diffGatewayContracts(gatewayDoc(), live)).toEqual({
      added: ['method session.steer'],
      removed: ['method ping', 'server request approval'],
      changed: ['event message.delta (payload)', 'method session.create (params)'],
    });
  });
});

describe('gateway capability markers', () => {
  test('match when the live gateway advertises what the pin recorded, plus anything new', () => {
    expect(markerMismatches(markers, { ...markers, capabilities: { ...markers.capabilities, new_flag: true } })).toEqual([]);
  });

  test('name every marker the live gateway lost or changed', () => {
    const live: GatewayMarkers = { replayEpoch: false, heartbeat: true, changeEvents: false, capabilities: {}, desktopContract: 8 };

    expect(markerMismatches(markers, live)).toEqual([
      'replay epoch: pinned true, live false',
      'change events: pinned true, live false',
      'gateway.capabilities per_session_exclusive_submit: pinned true, live missing',
      'desktop contract: pinned 7, live 8',
    ]);
  });

  test('do not count a desktop contract number that has not been observed yet', () => {
    expect(markerMismatches(markers, { ...markers, desktopContract: null })).toEqual([]);
  });
});
