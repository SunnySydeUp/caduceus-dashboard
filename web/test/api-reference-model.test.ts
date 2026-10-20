import { describe, expect, test } from 'vitest';
import type { ApiReferenceEntry } from '@caduceus/contracts/caduceus-api';
import { filterReference, referenceGroups } from '../src/modules/maintenance/api-reference-model.ts';

const entry = (over: Partial<ApiReferenceEntry>): ApiReferenceEntry => ({ kind: 'rest', method: 'GET', name: '/api/status', group: 'status', summary: 'Get Status', tier: 'T0', read: true, ...over });
const ENTRIES = [
  entry({}),
  entry({ method: 'POST', name: '/api/ops/doctor', group: 'ops', summary: 'Run Doctor', tier: 'T1', read: false }),
  entry({ kind: 'gateway', method: 'RPC', name: 'session.list', group: 'session', summary: 'List sessions', params: ['limit'] }),
  entry({ kind: 'gateway', method: 'RPC', name: 'shell.exec', group: 'shell', summary: 'Run a shell command', tier: 'denied', read: false }),
];

describe('narrowing the API reference', () => {
  test('every word typed must be in the name, the method, the summary, the group or a parameter', () => {
    expect(filterReference(ENTRIES, { query: 'doctor', tier: 'all', kind: 'all' }).map((e) => e.name)).toEqual(['/api/ops/doctor']);
    expect(filterReference(ENTRIES, { query: 'post ops', tier: 'all', kind: 'all' }).map((e) => e.name)).toEqual(['/api/ops/doctor']);
    expect(filterReference(ENTRIES, { query: 'limit', tier: 'all', kind: 'all' }).map((e) => e.name)).toEqual(['session.list']);
  });

  test('by tier, and by REST or gateway', () => {
    expect(filterReference(ENTRIES, { query: '', tier: 'denied', kind: 'all' }).map((e) => e.name)).toEqual(['shell.exec']);
    expect(filterReference(ENTRIES, { query: '', tier: 'all', kind: 'rest' })).toHaveLength(2);
  });

  test('groups what is left under its group, in order, with a count', () => {
    expect(referenceGroups(ENTRIES)).toEqual([
      { group: 'ops', entries: [ENTRIES[1]] },
      { group: 'session', entries: [ENTRIES[2]] },
      { group: 'shell', entries: [ENTRIES[3]] },
      { group: 'status', entries: [ENTRIES[0]] },
    ]);
  });
});
