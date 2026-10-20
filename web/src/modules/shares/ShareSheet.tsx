// "Share link…" (M7 #06): pick how long a read-only copy of the session lasts, confirm (Tier 1, naming the session and the profile), then copy the link. The
// link is shown once: only its hash is kept.
import { useId, useState } from 'react';
import type { ShareCreated, ShareExpiry } from '@caduceus/contracts/share-links';
import { Icon } from '../../icons.tsx';
import { Sheet } from '../../overlays/Sheet.tsx';
import { Term } from '../../shell/Term.tsx';
import { toast } from '../../shell/toasts.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { fetchTiered } from '../../tiered.ts';
import { nameOf } from '../chat/sessions-actions.ts';
import type { SessionItem } from '../chat/sessions-model.ts';
import { EXPIRY_CHOICES, expiryWords, shareLink } from './shares-model.ts';
import './shares.css';

type Made = { state: 'idle' } | { state: 'busy' } | { state: 'failed'; message: string } | { state: 'made'; created: ShareCreated };

export function ShareSheet({ item, profile, onClose }: { item: SessionItem; profile: string; onClose(): void }) {
  const [expiry, setExpiry] = useState<ShareExpiry>('7d');
  const [made, setMade] = useState<Made>({ state: 'idle' });
  const legend = useId();
  const owner = item.profile ?? profile;
  const name = nameOf(item);

  const create = async () => {
    setMade({ state: 'busy' });
    const result = await fetchTiered({
      method: 'POST',
      path: '/_caduceus/api/shares',
      body: { sessionId: item.id, profile: owner, expiry },
      confirm: {
        title: `Share “${name}”?`,
        text: `Caduceus freezes a read-only copy of the chat as it is now, and makes a link to it. Anyone on your tailnet who has the link can read the copy, without signing in. Secret tool arguments are hidden. ${expiryWords(expiry === 'never' ? null : new Date(Date.now() + { '1d': 1, '7d': 7, '30d': 30 }[expiry] * 86_400_000).toISOString())}.`,
        object: name,
        profile: owner,
        confirmLabel: 'Create link',
      },
    });
    if (result.kind === 'cancelled') return setMade({ state: 'idle' });
    if (result.kind === 'refused') return setMade({ state: 'failed', message: result.refusal.message });
    const body: unknown = await result.response.json().catch(() => undefined);
    if (result.response.ok && typeof body === 'object' && body !== null && 'token' in body) return setMade({ state: 'made', created: body as ShareCreated });
    const message = typeof body === 'object' && body !== null && 'message' in body && typeof body.message === 'string' ? body.message : `Caduceus answered HTTP ${result.response.status}.`;
    setMade({ state: 'failed', message });
  };

  const link = made.state === 'made' ? shareLink(made.created, location.origin) : undefined;
  return (
    <Sheet title="Share link" onClose={onClose}>
      <div className="stack">
        <p className="subtle">
          A <Term id="share-link">share link</Term> opens a read-only copy of “{name}” as it is now. It works only for devices on your tailnet: Caduceus is never put on the public internet.
        </p>
        {made.state !== 'made' && (
          <fieldset className="sh__choices" aria-describedby={legend}>
            <legend id={legend}>How long it lasts</legend>
            {EXPIRY_CHOICES.map((choice) => (
              <label key={choice.id} className="sh__choice">
                <input type="radio" name="share-expiry" checked={expiry === choice.id} onChange={() => setExpiry(choice.id)} />
                <span>{choice.label}</span>
              </label>
            ))}
          </fieldset>
        )}
        {made.state === 'failed' && (
          <p className="banner" data-tone="danger" role="alert">
            <Icon name="alert" />
            <span className="banner__content">{made.message}</span>
          </p>
        )}
        {link && made.state === 'made' && (
          <div className="stack" role="status">
            <label className="field__label" htmlFor={`${legend}-link`}>
              Link ({expiryWords(made.created.expiresAt)})
            </label>
            <input id={`${legend}-link`} className="input input--mono" readOnly value={link} onFocus={(event) => event.target.select()} />
            <p className="subtle">This is the only time the link is shown. Settings › Security lists your active shares and can revoke any of them.</p>
          </div>
        )}
        <div className="row">
          {link ? (
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => void navigator.clipboard?.writeText(link).then(() => toast('Copied the link'), () => toast('Could not copy: select the link and copy it', { tone: 'warning' }))}
            >
              <Icon name="copy" />
              Copy link
            </button>
          ) : (
            <WriteButton type="button" className="btn btn--primary" disabled={made.state === 'busy'} onClick={() => void create()}>
              Create link…
            </WriteButton>
          )}
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            {link ? 'Done' : 'Cancel'}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
