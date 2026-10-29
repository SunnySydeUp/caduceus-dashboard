import { useEffect, useRef, useState } from 'react';
import { Icon } from '../icons.tsx';
import { Sheet } from '../overlays/Sheet.tsx';
import { PasskeyError, passkeyCount, setStepUpPrompt, stepUp } from '../passkeys.ts';
import { TIER_LABELS } from '../tier-flow.ts';
import { AppLink } from './navigation.tsx';
import { Term } from './Term.tsx';

/**
 * The step-up prompt: when the server answers `step-up-required`, this asks the owner to confirm with a passkey.
 * It is the T2 confirmation of the tiered dialog (M0 #08): it must be answered, so a tap outside does nothing; Escape
 * and back cancel. The passkey prompt opens from the button press, because Safari only allows WebAuthn from a user
 * gesture. With no passkey set up it says so as it opens, turns the button off and links to where one is added.
 */
export function StepUpDialog() {
  const [open, setOpen] = useState(false);
  const settle = useRef<(confirmed: boolean) => void>(undefined);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [passkeys, setPasskeys] = useState<number>();

  useEffect(() => {
    setStepUpPrompt(() => {
      const { promise, resolve } = Promise.withResolvers<boolean>();
      settle.current = resolve;
      setError(undefined);
      setPasskeys(undefined);
      setOpen(true);
      void passkeyCount().then(setPasskeys);
      return promise;
    });
    return () => setStepUpPrompt(undefined);
  }, []);

  const finish = (confirmed: boolean) => {
    settle.current?.(confirmed);
    settle.current = undefined;
    setOpen(false);
  };

  const confirm = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await stepUp();
      finish(true);
    } catch (failure) {
      setError(failure instanceof PasskeyError ? failure.message : 'Caduceus is not reachable. Check the connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;
  const missing = passkeys === 0;
  return (
    <Sheet
      title="Confirm it’s you"
      role="alertdialog"
      dismissOnScrim={false}
      initialFocus="[data-cancel]"
      onClose={() => finish(false)}
      footer={
        <>
          <button type="button" className="btn btn--secondary" data-cancel onClick={() => finish(false)}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" disabled={busy || missing} aria-busy={busy} onClick={() => void confirm()}>
            <Icon name="fingerprint" />
            <span>Use passkey</span>
          </button>
        </>
      }
    >
      <p className="overline confirm__tier">
        <Term id="step-up">{TIER_LABELS.T2}</Term>
      </p>
      <div className="stepup" data-state={missing ? 'missing' : busy ? 'waiting' : undefined}>
        <Icon name={missing ? 'lock' : 'fingerprint'} />
        <div className="stepup__text">
          <strong>{missing ? 'You have no passkey yet' : busy ? 'Waiting for passkey…' : 'Passkey required'}</strong>
          <small>
            {missing
              ? 'This change needs a passkey to confirm it, and none is set up. Add one in Settings › Security, then come back.'
              : 'This change needs a fresh confirmation with one of your passkeys. It covers the next 5 minutes on this device.'}
          </small>
          {missing && (
            <AppLink className="btn btn--secondary btn--sm stepup__action" to="/system/security">
              Add a passkey
            </AppLink>
          )}
        </div>
      </div>
      {error && !missing && (
        <p className="field__error" role="alert">
          <Icon name="alert" small />
          {error}
        </p>
      )}
    </Sheet>
  );
}
