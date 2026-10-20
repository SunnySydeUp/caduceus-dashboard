import { useEffect, useRef, useState } from 'react';
import { Icon } from '../icons.tsx';
import { Sheet } from '../overlays/Sheet.tsx';
import type { ConfirmRequest } from '../palette.ts';
import { PasskeyError, stepUp, stepUpLive } from '../passkeys.ts';
import { useReadOnly } from '../policy-state.ts';
import { confirmBlocker, recoverabilityText, TIER_LABELS } from '../tier-flow.ts';
import { Sigil } from './Sigil.tsx';
import { useOnline } from './connection.ts';
import { setTierConfirmer, type ConfirmAnswer } from './tier-confirmation.ts';
import { Term } from './Term.tsx';

/** What the dialog says when its confirm button cannot be pressed, other than for want of a typed name. */
const BLOCKED_TEXT = {
  offline: 'You are offline. This action is never queued: do it when you are back online.',
  'read-only': 'Read-only mode is on, so this cannot be done. Turn read-only mode off in Settings › Security first.',
} as const;

/**
 * The one tiered confirmation dialog every module uses (mobile-and-interaction.md §5): a bottom sheet on a phone and a
 * dialog elsewhere. T1 names the object and the profile chip and confirms; T2 asks for a passkey; T3 asks for the object's
 * name to be typed, states whether the action can be undone, and asks for the passkey too. It installs itself as the
 * confirmer while it is mounted (`setTierConfirmer`), so the palette, the shortcuts and `fetchTiered` all use it.
 *
 * T2 and T3 must be answered: a tap outside does nothing. Escape and the close button decline.
 */
export function TierDialog() {
  const [request, setRequest] = useState<ConfirmRequest>();
  const settle = useRef<(answer: ConfirmAnswer | undefined) => void>(undefined);

  useEffect(() => {
    setTierConfirmer((next) => {
      // A second request while one is open declines the first: the owner is answering one question at a time.
      settle.current?.(undefined);
      const { promise, resolve } = Promise.withResolvers<ConfirmAnswer | undefined>();
      settle.current = resolve;
      setRequest(next);
      return promise;
    });
    return () => {
      settle.current?.(undefined);
      setTierConfirmer(undefined);
    };
  }, []);

  const finish = (answer: ConfirmAnswer | undefined) => {
    settle.current?.(answer);
    settle.current = undefined;
    setRequest(undefined);
  };

  return request ? <TierSheet key={request.action + request.label} request={request} finish={finish} /> : null;
}

function TierSheet({ request, finish }: { request: ConfirmRequest; finish(answer: ConfirmAnswer | undefined): void }) {
  const { tier, label, text, profile, confirmLabel = 'Confirm' } = request;
  // A T3 asks for the object's name; an action with none is confirmed by typing its title.
  const object = request.object ?? (tier === 'T3' ? label : undefined);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string>();
  const online = useOnline();
  const readOnly = useReadOnly();
  const blocker = confirmBlocker({ tier, object, typed, online, readOnly });
  const needsPasskey = tier !== 'T1';
  // A passkey the owner gave in the last few minutes still covers this: asking again would be a step-up for nothing.
  const covered = needsPasskey && stepUpLive();

  const confirm = async () => {
    if (blocker || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      if (needsPasskey && !stepUpLive()) {
        setWaiting(true);
        await stepUp();
      }
      finish({ typed: typed.trim() });
    } catch (failure) {
      setWaiting(false);
      setError(failure instanceof PasskeyError ? failure.message : 'Caduceus is not reachable. Check the connection and try again.');
      setBusy(false);
    }
  };

  const danger = tier === 'T3';
  const stepUpState = waiting ? 'waiting' : covered ? 'ok' : undefined;
  return (
    <Sheet
      title={label}
      role="alertdialog"
      dismissOnScrim={tier === 'T1'}
      initialFocus={tier === 'T3' ? '[data-t3]' : '[data-cancel]'}
      onClose={() => finish(undefined)}
      footer={
        <>
          <button type="button" className="btn btn--secondary" data-cancel disabled={busy} onClick={() => finish(undefined)}>
            Cancel
          </button>
          <button
            type="button"
            className={`btn ${danger ? 'btn--danger' : 'btn--primary'}`}
            data-confirm
            disabled={blocker !== undefined}
            aria-busy={busy}
            onClick={() => void confirm()}
          >
            {needsPasskey && !covered && <Icon name="fingerprint" />}
            <span>{confirmLabel}</span>
          </button>
        </>
      }
    >
      <p className="overline confirm__tier">
        <Term id="risk-tiers">{TIER_LABELS[tier]}</Term>
      </p>
      {text && <p className="confirm__text">{text}</p>}
      {object && tier !== 'T3' && (
        <div className="confirm__scope">
          <span className="subtle">Changes</span>
          <span className="mono">{object}</span>
        </div>
      )}
      {profile && (
        <div className="confirm__scope">
          <span className="subtle">Profile</span>
          <span className="ptag">
            <Sigil name={profile} size="xs" />
            <span className="ptag__name">{profile === 'all' ? 'All profiles' : profile}</span>
          </span>
        </div>
      )}
      {tier === 'T3' && (
        <>
          <div className="banner" data-tone="danger">
            <Icon name="alert" />
            <div className="banner__content">
              <div className="banner__title">{recoverabilityText(request.recoverability)}</div>
            </div>
            <span />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="tier-typed">
              Type <span className="mono">{object}</span> to confirm
            </label>
            <input
              id="tier-typed"
              className="input input--mono"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              data-t3
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && void confirm()}
            />
          </div>
        </>
      )}
      {needsPasskey && (
        <div className="stepup" data-state={stepUpState}>
          <Icon name={covered && !waiting ? 'succeeded' : 'fingerprint'} />
          <div className="stepup__text">
            <strong>{waiting ? 'Waiting for passkey…' : covered ? 'Passkey confirmed' : 'Passkey required'}</strong>
            <small>
              {waiting
                ? 'Touch your security key or use Face ID / Touch ID.'
                : covered
                  ? 'You confirmed with a passkey a moment ago; it still covers this device for a few minutes.'
                  : 'This asks for one of your passkeys. It covers the next 5 minutes on this device.'}
            </small>
          </div>
        </div>
      )}
      {(blocker === 'offline' || blocker === 'read-only') && (
        <p className="field__error" role="alert">
          <Icon name="alert" small />
          {BLOCKED_TEXT[blocker]}
        </p>
      )}
      {error && (
        <p className="field__error" role="alert">
          <Icon name="alert" small />
          {error}
        </p>
      )}
    </Sheet>
  );
}
