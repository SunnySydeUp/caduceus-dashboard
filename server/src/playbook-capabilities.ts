// What the installed Hermes can do with the workflow fields (M6 #02), read from the contracts Caduceus pinned for it: the Kanban plugin's create body,
// and the markers Hermes advertised. Until Hermes accepts `workflow_template_id` and `current_step_key` on create, the engine tags a stage task through
// `idempotency_key` only; once it does, the engine writes the native fields too and the Board's filter can use Hermes's own. Hermes that reports it routes
// workflows natively on those fields takes the routing over from the engine.
import { isRecord } from '@caduceus/contracts/policy/guards';
import type { WorkflowCapabilities } from './playbook-engine.ts';
import type { HermesContracts } from './hermes-contract.ts';

export function workflowCapabilities(contracts: Pick<HermesContracts, 'rest' | 'markers'>): WorkflowCapabilities {
  const components: unknown = (contracts.rest as { components?: unknown }).components;
  const schemas = isRecord(components) ? components.schemas : undefined;
  const create = isRecord(schemas) ? schemas.CreateTaskBody : undefined;
  const properties = isRecord(create) && isRecord(create.properties) ? create.properties : {};
  const markers: unknown = contracts.markers;
  const capabilities = isRecord(markers) && isRecord(markers.capabilities) ? markers.capabilities : {};
  return {
    nativeTags: 'workflow_template_id' in properties && 'current_step_key' in properties,
    nativeRouting: capabilities.workflow_routing === true,
  };
}
