import { useId, useState } from 'react';
import { Icon } from '../../icons.tsx';
import { StatusBadge } from '../../shell/StatusBadge.tsx';
import { Term } from '../../shell/Term.tsx';
import { toast } from '../../shell/toasts.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { activateEndpoint, deleteEndpoint, saveEndpoint } from './endpoint-actions.ts';
import { EndpointSheet } from './EndpointSheet.tsx';
import { API_MODES, emptyEndpointForm, endpointFormOf, type Endpoint, type EndpointForm } from './keys-model.ts';
import './keys.css';
import './pool-endpoints.css';

type Editing = { mode: 'add' } | { mode: 'edit'; endpoint: Endpoint };

/** System › Keys › Custom endpoints: model servers of the owner's own, and which one the profile chats with. */
export function EndpointsSection({ profile, endpoints, onChanged }: { profile: string; endpoints: Endpoint[]; onChanged(): Promise<void> }) {
  const headingId = useId();
  const [editing, setEditing] = useState<Editing>();
  const [busy, setBusy] = useState<string>();

  const save = async (form: EndpointForm): Promise<boolean> => {
    const outcome = await saveEndpoint(form, profile);
    if (outcome.kind === 'cancelled') return false;
    if (outcome.kind === 'failed') {
      toast(outcome.message, { tone: 'danger' });
      return false;
    }
    toast(`${form.id ? 'Saved' : 'Added'} the endpoint ${form.name.trim()}`, { detail: `Profile ${profile}`, tone: 'success' });
    await onChanged();
    return true;
  };

  const activate = async (endpoint: Endpoint) => {
    setBusy(endpoint.id);
    const outcome = await activateEndpoint(endpoint, profile);
    setBusy(undefined);
    if (outcome.kind === 'cancelled') return;
    if (outcome.kind === 'failed') {
      toast(outcome.message, { tone: 'danger' });
      return;
    }
    toast(`${endpoint.name} is now the chat model`, { detail: `Profile ${profile}`, tone: 'success' });
    await onChanged();
  };

  const remove = async (endpoint: Endpoint) => {
    setBusy(endpoint.id);
    const outcome = await deleteEndpoint(endpoint, profile);
    setBusy(undefined);
    if (outcome.kind === 'cancelled') return;
    if (outcome.kind === 'failed') {
      toast(outcome.message, { tone: 'danger' });
      return;
    }
    toast(`Deleted the endpoint ${endpoint.name}`, { detail: `Profile ${profile}`, tone: 'success' });
    await onChanged();
  };

  return (
    <section className="ky-section" aria-labelledby={headingId}>
      <div className="ky-section__head">
        <h2 className="ky-section__title" id={headingId}>
          <Icon name="server" />
          Custom endpoints
          <span className="ky-section__count">{endpoints.length}</span>
        </h2>
        <WriteButton type="button" className="btn btn--secondary btn--sm" onClick={() => setEditing({ mode: 'add' })}>
          <Icon name="plus" small />
          Add endpoint
        </WriteButton>
      </div>
      <p className="ky-section__lead">
        A <Term id="custom-endpoint">custom endpoint</Term> is a model server of your own: vLLM, LM Studio, Ollama or any OpenAI-compatible address.
      </p>
      {endpoints.length === 0 ? (
        <div className="empty">
          <span className="empty__icon">
            <Icon name="server" />
          </span>
          <p>No custom endpoints</p>
          <p>Add the address of a model server you run, then make it the chat model of this profile.</p>
          <WriteButton type="button" className="btn btn--primary" onClick={() => setEditing({ mode: 'add' })}>
            <Icon name="plus" />
            Add endpoint
          </WriteButton>
        </div>
      ) : (
        <ul className="ky-cards" aria-label="Custom endpoints">
          {endpoints.map((endpoint) => {
            const working = busy === endpoint.id;
            return (
              <li className="ky-card" key={endpoint.id} data-current={endpoint.isCurrent}>
                <div className="ky-card__top">
                  <div className="ky-card__id">
                    <h3 className="ky-card__name">{endpoint.name}</h3>
                    {endpoint.isCurrent && <StatusBadge state="online" label="In use" variant="plain" />}
                  </div>
                </div>
                <code className="ky-url mono">{endpoint.baseUrl}</code>
                <div className="ky-card__tags">
                  {endpoint.model && <span className="tag ky-pe-tag mono">{endpoint.model}</span>}
                  {endpoint.models.length > 1 && <span className="tag ky-pe-tag">{endpoint.models.length} models</span>}
                  <span className="tag ky-pe-tag">{API_MODES.find((mode) => mode.value === endpoint.apiMode)?.label ?? 'Detects the API'}</span>
                  <span className="tag ky-pe-tag">{endpoint.hasApiKey ? 'API key set' : 'No API key'}</span>
                  {endpoint.contextLength !== undefined && <span className="tag ky-pe-tag">Context {endpoint.contextLength.toLocaleString('en-US')} tokens</span>}
                </div>
                <div className="ky-card__actions">
                  <WriteButton type="button" className="btn btn--secondary btn--sm" disabled={working} aria-label={`Edit ${endpoint.name}`} onClick={() => setEditing({ mode: 'edit', endpoint })}>
                    <Icon name="settings" small />
                    Edit
                  </WriteButton>
                  {!endpoint.isCurrent && (
                    <WriteButton type="button" className="btn btn--secondary btn--sm" disabled={working} aria-busy={working} aria-label={`Use ${endpoint.name} as the chat model`} onClick={() => void activate(endpoint)}>
                      <Icon name="play" small />
                      Use
                    </WriteButton>
                  )}
                  <WriteButton type="button" className="btn btn--ghost btn--sm ky-pe-danger ky-card__more" disabled={working} aria-busy={working} aria-label={`Delete the endpoint ${endpoint.name}`} onClick={() => void remove(endpoint)}>
                    <Icon name="trash" small />
                    Delete
                  </WriteButton>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {editing && (
        <EndpointSheet
          key={editing.mode === 'edit' ? editing.endpoint.id : 'new'}
          mode={editing.mode}
          initial={editing.mode === 'edit' ? endpointFormOf(editing.endpoint) : emptyEndpointForm()}
          hadKey={editing.mode === 'edit' && editing.endpoint.hasApiKey}
          profile={profile}
          onSave={save}
          onClose={() => setEditing(undefined)}
        />
      )}
    </section>
  );
}
