import { useId, useState } from 'react';
import { Icon } from '../../icons.tsx';
import { Loading } from '../../shell/Loading.tsx';
import { closeAllLayers } from '../../overlays/layers.ts';
import { Sheet } from '../../overlays/Sheet.tsx';
import { Term } from '../../shell/Term.tsx';
import { toast } from '../../shell/toasts.ts';
import { useSizeClass } from '../../shell/use-size-class.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { createHook, removeHook } from './hooks-actions.ts';
import { useHooks } from './hooks-data.ts';
import type { Hook } from './hooks-model.ts';
import { HookSheet } from './HookSheet.tsx';
import './tools.css';

/** The profile's shell hooks: each with its event, command and profile, a Create hook button, and Remove (a ⋮ menu on a phone). */
export function HooksPanel({ profile }: { profile: string }) {
  const view = useHooks(profile);
  const compact = useSizeClass() === 'compact';
  const [creating, setCreating] = useState(false);
  const [menu, setMenu] = useState<Hook>();
  const data = view.value;
  const heading = useId();

  const create = async (form: Parameters<typeof createHook>[0]) => {
    const outcome = await createHook(form, profile);
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    if (outcome.kind !== 'done') return false;
    toast(`Created the ${form.event.trim()} hook for ${profile}`, { detail: 'New sessions run it.' });
    await view.reload();
    return true;
  };

  const remove = async (hook: Hook) => {
    const outcome = await removeHook(hook, profile);
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    if (outcome.kind !== 'done') return;
    toast(`Removed the ${hook.event} hook from ${profile}`, { detail: 'Its consent is withdrawn.' });
    await view.reload();
  };

  return (
    <div className="tl-panel">
      <p className="help-text">
        A <Term id="shell-hook">shell hook</Term> runs a command of yours when an event happens in a session of <strong>{profile}</strong>. These are the hooks in the profile’s config, as Hermes lists them. They run on this computer, with the access of your account, in new sessions; a chat that is already open keeps the hooks it started with.
      </p>
      {view.failed && (
        <div className="banner" data-tone="danger" role="alert">
          <Icon name="alert" />
          <span className="banner__content">Hermes did not answer, so its hooks could not be listed{data ? ': this is the list from a moment ago' : ''}.</span>
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => void view.reload()}>
            <Icon name="refresh" />
            Retry
          </button>
        </div>
      )}
      {!data && !view.failed && <Loading label="Loading hooks…" lines={3} onRetry={() => void view.reload()} />}
      {data && (
        <div className="tl-bar">
          <WriteButton type="button" className="btn btn--primary" onClick={() => setCreating(true)}>
            <Icon name="plus" />
            Create hook…
          </WriteButton>
          <span id={heading} className="subtle" role="status">
            {data.hooks.length === 0 ? 'No hooks yet' : `${data.hooks.length} ${data.hooks.length === 1 ? 'hook' : 'hooks'}`}
          </span>
        </div>
      )}
      {data && data.hooks.length > 0 && (
        <ul className="tl-cards" aria-label="Shell hooks" data-layout={compact ? 'list' : 'grid'}>
          {data.hooks.map((hook) => (
            <li className="tl-card" key={`${hook.event}\n${hook.command}`}>
              <div className="tl-card__top">
                <div className="tl-card__id">
                  <h3 className="tl-card__name mono">{hook.event}</h3>
                  <code className="tl-code">{hook.command}</code>
                </div>
                {compact && (
                  <div className="tl-card__switch">
                    <button type="button" className="btn btn--ghost btn--icon" aria-label={`Actions for the ${hook.event} hook`} aria-haspopup="dialog" onClick={() => setMenu(hook)}>
                      <Icon name="dots-v" />
                    </button>
                  </div>
                )}
              </div>
              <div className="tl-card__tags">
                <span className="tag">{hook.profile}</span>
                {hook.matcher && <span className="tag">Matcher {hook.matcher}</span>}
                {hook.timeout !== undefined && <span className="tag">{hook.timeout} s</span>}
                <span className="tag" data-tone={hook.allowed ? 'success' : 'warning'}>
                  {hook.allowed ? 'Consent on record' : 'No consent: it does not run'}
                </span>
                {!hook.executable && (
                  <span className="tag" data-tone="warning">
                    Hermes cannot run it as written
                  </span>
                )}
              </div>
              {!compact && (
                <div className="tl-card__actions">
                  <WriteButton type="button" className="btn btn--secondary btn--sm" aria-label={`Remove the ${hook.event} hook ${hook.command}`} onClick={() => void remove(hook)}>
                    <Icon name="trash" small />
                    Remove…
                  </WriteButton>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {data && data.hooks.length === 0 && (
        <div className="empty">
          <span className="empty__icon">
            <Icon name="bolt" />
          </span>
          <p>This profile has no shell hooks. A hook runs a command of yours when something happens in a session, such as before a tool is used.</p>
          <WriteButton type="button" className="btn btn--primary" onClick={() => setCreating(true)}>
            <Icon name="plus" />
            Create hook…
          </WriteButton>
        </div>
      )}
      {creating && data && <HookSheet profile={profile} events={data.events} onSubmit={create} onClose={() => setCreating(false)} />}
      {menu && (
        <Sheet title={`${menu.event} hook`} detents={['auto']} onClose={() => setMenu(undefined)}>
          <ul className="pf-acts">
            <li>
              <button
                type="button"
                className="pf-act pf-act--danger"
                onClick={() => {
                  const hook = menu;
                  setMenu(undefined);
                  // The menu is closed before the next dialog opens, so the layers never stack.
                  void closeAllLayers().then(() => remove(hook));
                }}
              >
                <Icon name="trash" />
                <span>
                  <span>Remove…</span>
                  <small>Needs your passkey · from {profile}</small>
                </span>
              </button>
            </li>
          </ul>
          <p className="tl-note tl-code">{menu.command}</p>
        </Sheet>
      )}
    </div>
  );
}
