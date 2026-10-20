// The changes System › Keys › Custom endpoints makes in Hermes, each through `fetchTiered` (save and delete are Tier 2, Use and Check Tier 1). The caller
// shows toasts and reloads; this says what happened. An API key typed in the form goes to Hermes and nowhere else: no confirmation or message has one.
import { fetchTiered } from '../../tiered.ts';
import { runTiered, type ActionOutcome } from '../profiles/profile-actions.ts';
import { endpointActivate, endpointCheck, endpointDelete, endpointSave, parseEndpointCheck, type Endpoint, type EndpointCheck, type EndpointForm } from './keys-model.ts';

/** Creates the endpoint or saves an edit (T2). */
export function saveEndpoint(form: EndpointForm, profile: string): Promise<ActionOutcome> {
  const name = form.name.trim();
  return runTiered(
    fetchTiered({
      ...endpointSave(form, profile),
      confirm: {
        title: `${form.id ? 'Save changes to' : 'Add'} the endpoint ${name} for ${profile}?`,
        text: `Hermes saves the address ${form.baseUrl.trim()} in the profile’s config. An API key typed here is stored by Hermes in the profile’s environment, never in the config file.`,
        object: name,
        profile,
        confirmLabel: form.id ? 'Save changes' : 'Add endpoint',
      },
    }),
  );
}

/** Deletes the endpoint and the key Hermes holds for it (T2). */
export function deleteEndpoint(endpoint: Endpoint, profile: string): Promise<ActionOutcome> {
  return runTiered(
    fetchTiered({
      ...endpointDelete(endpoint.id, profile),
      confirm: {
        title: `Delete the endpoint ${endpoint.name} from ${profile}?`,
        text: 'Hermes removes the endpoint and the key it holds for it. If it is the chat model, the profile is left without one.',
        object: endpoint.id,
        profile,
        confirmLabel: 'Delete endpoint',
      },
    }),
  );
}

/** Makes the endpoint the profile's chat model (T1). Not named `use…`: it is a plain action, not a hook. */
export function activateEndpoint(endpoint: Endpoint, profile: string): Promise<ActionOutcome> {
  return runTiered(
    fetchTiered({
      ...endpointActivate(endpoint.id, profile),
      confirm: {
        title: `Make ${endpoint.name} the chat model of ${profile}?`,
        text: 'Hermes sets this endpoint and its model as the profile’s main model. New chats use it.',
        object: endpoint.name,
        profile,
        confirmLabel: 'Use this endpoint',
      },
    }),
  );
}

/** Asks Hermes to look at the address in the form (T1: it contacts the address and sends the key typed in the form, if any). */
export async function checkEndpoint(form: EndpointForm, profile: string): Promise<ActionOutcome<EndpointCheck>> {
  const outcome = await runTiered(
    fetchTiered({
      ...endpointCheck(form),
      confirm: {
        title: `Check ${form.baseUrl.trim()}?`,
        text: 'Hermes asks the address for its model list and tries a request the way a chat would. The API key typed in the form, if any, is sent to that address.',
        object: form.baseUrl.trim(),
        profile,
        confirmLabel: 'Check endpoint',
      },
    }),
  );
  return outcome.kind === 'done' ? { kind: 'done', body: parseEndpointCheck(outcome.body) } : outcome;
}
