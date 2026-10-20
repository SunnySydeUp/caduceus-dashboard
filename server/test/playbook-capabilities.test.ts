import { describe, expect, test } from 'vitest';
import { workflowCapabilities } from '../src/playbook-capabilities.ts';
import { loadPinnedContracts } from '../src/hermes-contract.ts';

// What the engine may do with Hermes's workflow fields (M6 #02), read from the contracts pinned for the installed Hermes.
const contracts = (properties: Record<string, unknown>, capabilities: Record<string, boolean> = {}) =>
  ({ rest: { components: { schemas: { CreateTaskBody: { properties } } } }, markers: { capabilities } }) as unknown as Parameters<typeof workflowCapabilities>[0];

describe('the workflow capabilities of the installed Hermes', () => {
  test('the pinned contract of Hermes 0.21.4 accepts neither native field on create and routes nothing itself', async () => {
    expect(workflowCapabilities(await loadPinnedContracts())).toEqual({ nativeTags: false, nativeRouting: false });
  });

  test('native tags turn on only when the create body takes both fields, and native routing when Hermes advertises it', () => {
    expect(workflowCapabilities(contracts({ title: {}, workflow_template_id: {} }))).toEqual({ nativeTags: false, nativeRouting: false });
    expect(workflowCapabilities(contracts({ workflow_template_id: {}, current_step_key: {} }))).toEqual({ nativeTags: true, nativeRouting: false });
    expect(workflowCapabilities(contracts({}, { workflow_routing: true }))).toEqual({ nativeTags: false, nativeRouting: true });
  });
});
