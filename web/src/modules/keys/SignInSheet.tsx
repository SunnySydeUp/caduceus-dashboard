import { useEffect, useRef, useState } from 'react';
import { Icon } from '../../icons.tsx';
import { Sheet } from '../../overlays/Sheet.tsx';
import { toast } from '../../shell/toasts.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { CopyText } from '../webhooks/CopyText.tsx';
import { followLogin, type DeviceCode, type LoginDriver, type LoginEnd, type OauthProvider } from './keys-model.ts';
import { cancelSignIn, pollSignIn, startSignIn } from './oauth-actions.ts';
import './keys.css';
import './oauth.css';

/** A wait that ends on time or the moment `signal` aborts, and leaves no timer or listener behind. */
function abortableWait(ms: number, signal?: AbortSignal): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  if (signal?.aborted) {
    resolve();
    return promise;
  }
  const finish = () => {
    clearTimeout(timer);
    signal?.removeEventListener('abort', finish);
    resolve();
  };
  const timer = setTimeout(finish, ms);
  signal?.addEventListener('abort', finish, { once: true });
  return promise;
}

/** The status line of a sign-in that is waiting, with a live countdown. Mounted once per code, so the clock starts with the code. */
function Countdown({ seconds }: { seconds: number }) {
  const [lapsesAt] = useState(() => Date.now() + seconds * 1000);
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    const timer = setInterval(() => setLeft(Math.max(0, Math.ceil((lapsesAt - Date.now()) / 1000))), 1000);
    return () => clearInterval(timer);
  }, [lapsesAt]);
  const clock = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  const minutes = Math.ceil(left / 60);
  return (
    <p className="ky-oa-wait" role="status">
      Waiting for approval…{' '}
      {left > 0 ? (
        <>
          <span aria-hidden="true">
            the code runs out in <span className="ky-oa-time">{clock}</span>
          </span>
          <span className="sr-only">the code runs out in about {minutes} {minutes === 1 ? 'minute' : 'minutes'}</span>
        </>
      ) : (
        'the code has run out: asking Hermes how it ended'
      )}
    </p>
  );
}

/**
 * A device-code sign-in as Hermes runs it: the link to open and the code to enter, and a live follow of Hermes's own record until the
 * person approves, declines or the code runs out. Hermes saves the token; this page never sees it, nor the password.
 */
export function SignInSheet({ provider, code: first, profile, onFinished, onClose }: { provider: OauthProvider; code: DeviceCode; profile: string; onFinished(): void; onClose(): void }) {
  const [code, setCode] = useState(first);
  const [end, setEnd] = useState<LoginEnd>();
  const [retrying, setRetrying] = useState(false);
  const alive = useRef(true);
  const finished = useRef(onFinished);
  finished.current = onFinished;
  const closed = useRef(onClose);
  closed.current = onClose;
  const pending = end === undefined;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const driver: LoginDriver = { poll: () => pollSignIn(provider, code, profile), wait: abortableWait, now: Date.now };
    void followLogin(code, driver, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      if (result.state === 'cancelled') {
        closed.current();
        return;
      }
      if (result.state === 'approved') finished.current();
      setEnd(result);
    });
    return () => controller.abort();
  }, [code, provider, profile]);

  const close = () => {
    if (pending) void cancelSignIn(code.sessionId, profile);
    onClose();
  };

  const retry = async () => {
    setRetrying(true);
    const outcome = await startSignIn(provider, profile);
    if (alive.current) setRetrying(false);
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    if (outcome.kind !== 'done') return;
    if (!alive.current) {
      void cancelSignIn(outcome.body.sessionId, profile);
      return;
    }
    setEnd(undefined);
    setCode(outcome.body);
  };

  const footer =
    end?.state === 'approved' ? (
      <button type="button" className="btn btn--primary" onClick={onClose}>
        Done
      </button>
    ) : (
      <button type="button" className="btn btn--secondary" onClick={close}>
        {pending ? 'Cancel sign-in' : 'Close'}
      </button>
    );

  return (
    <Sheet title={`Connect ${provider.name}`} detents={['full']} className="ky-sheet" footer={footer} onClose={close}>
      <div className="ky-form">
        {pending && (
          <ol className="ky-oa-steps">
            <li className="ky-oa-step">
              <h3 className="ky-oa-step__title">Open this page</h3>
              <p className="ky-note">On any device where you are signed in to {provider.name}.</p>
              <code className="ky-url mono">{code.verificationUrl}</code>
              <div className="ky-actions">
                <CopyText text={code.verificationUrl} what={`the ${provider.name} sign-in link`} label="Copy link" />
                <a className="btn btn--secondary btn--sm" href={code.verificationUrl} target="_blank" rel="noreferrer noopener">
                  <Icon name="external" small />
                  Open
                </a>
              </div>
            </li>
            <li className="ky-oa-step">
              <h3 className="ky-oa-step__title">Enter this code</h3>
              <code className="ky-oa-code">{code.userCode}</code>
              <div className="ky-actions">
                <CopyText text={code.userCode} what={`the ${provider.name} sign-in code`} label="Copy code" />
              </div>
            </li>
            <li className="ky-oa-step">
              <h3 className="ky-oa-step__title">Wait</h3>
              <Countdown key={code.sessionId} seconds={code.expiresIn} />
            </li>
          </ol>
        )}
        {end?.state === 'approved' && (
          <div className="banner" data-tone="success" role="status">
            <Icon name="check" />
            <span className="banner__content">Connected to {provider.name}</span>
          </div>
        )}
        {end && end.state !== 'approved' && (
          <div className="banner" data-tone={end.state === 'expired' ? 'warning' : 'danger'} role="alert">
            <Icon name="alert" />
            <span className="banner__content">{end.message ?? 'The sign-in did not finish.'}</span>
            <WriteButton type="button" className="btn btn--secondary btn--sm" disabled={retrying} aria-busy={retrying} onClick={() => void retry()}>
              <Icon name="refresh" small />
              Try again
            </WriteButton>
          </div>
        )}
        <p className="ky-note">Hermes keeps the login it is given, on the computer it runs on. Caduceus never sees your password and the browser stores no token.</p>
      </div>
    </Sheet>
  );
}
