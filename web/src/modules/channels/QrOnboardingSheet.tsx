// Connect › Channels › Create with QR (Telegram) and Pair with QR (WhatsApp) (M5 #03): the QR Hermes made, polled until it reports the bot made or the device linked, and then who
// may talk to the agent. The QR is drawn large for scanning from another device; because the owner may be on the same phone, a link (or code) to copy is always shown.
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { renderSVG } from 'uqr';
import { Icon } from '../../icons.tsx';
import { Sheet } from '../../overlays/Sheet.tsx';
import { Term } from '../../shell/Term.tsx';
import { toast } from '../../shell/toasts.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { applyOnboarding, cancelOnboarding } from './onboarding-actions.ts';
import { clock, onboardingRequests, parseAllowedUsers, readTelegramPoll, readWhatsAppPoll, secondsLeft, type OnboardingState, type QrPlatform } from './qr-onboarding.ts';
import './channels.css';

const POLL_MS = 2000;
const NAME: Record<QrPlatform, string> = { telegram: 'Telegram', whatsapp: 'WhatsApp' };

/** The QR as an image the browser draws from data (never as markup). */
function QrImage({ text, label }: { text: string; label: string }) {
  const src = useMemo(() => `data:image/svg+xml;utf8,${encodeURIComponent(renderSVG(text, { border: 2 }))}`, [text]);
  return <img className="qr__image" src={src} alt={label} width={288} height={288} />;
}

export function QrOnboardingSheet({ platform, profile, initial, onRestart, onDone, onClose }: { platform: QrPlatform; profile: string; initial: OnboardingState; onRestart(): void; onDone(): void; onClose(): void }) {
  const [state, setState] = useState<OnboardingState>(initial);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();
  const [people, setPeople] = useState(initial.phase === 'linked' ? initial.suggestedUsers : '');
  const qr = useRef<Extract<OnboardingState, { phase: 'qr' }>>(null);
  const live = state.phase === 'qr' || state.phase === 'preparing';
  const pairingId = 'pairingId' in state ? state.pairingId : undefined;
  if (state.phase === 'qr') qr.current = state;

  // Asking Hermes again (a bounded read every two seconds, which is how Hermes's pairing is polled), until the pairing ends one way or another.
  useEffect(() => {
    if (!live || !pairingId) return;
    let active = true;
    const timer = setInterval(async () => {
      const res = await fetch(onboardingRequests.status(platform, pairingId).path).catch(() => undefined);
      if (!active || !res) return;
      const body: unknown = await res.json().catch(() => undefined);
      const next = platform === 'telegram' ? (qr.current ? readTelegramPoll(res.status, body, pairingId, qr.current) : undefined) : readWhatsAppPoll(res.status, body);
      if (active && next) setState(next);
    }, POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [live, pairingId, platform]);

  // The countdown to the QR's expiry; at zero Hermes will say expired on its next answer, and the QR is not offered for scanning any more.
  useEffect(() => {
    if (state.phase !== 'qr') return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [state.phase]);

  // What Hermes says to offer (the scanner's own Telegram id, a WhatsApp number) fills the field when the pairing links.
  const suggested = state.phase === 'linked' ? state.suggestedUsers : undefined;
  useEffect(() => {
    if (suggested !== undefined) setPeople(suggested);
  }, [suggested]);

  const left = state.phase === 'qr' ? secondsLeft(state.expiresAt, now) : undefined;
  const lapsed = left === 0;

  const close = () => {
    if (live && pairingId) void cancelOnboarding(platform, pairingId);
    onClose();
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(platform === 'telegram' ? 'Link copied' : 'Code copied');
    } catch {
      toast('Could not copy. Select the text and copy it by hand.', { tone: 'danger' });
    }
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (state.phase !== 'linked') return;
    const parsed = parseAllowedUsers(platform, people);
    if (!parsed.ok) return setProblem(parsed.message);
    setProblem(undefined);
    setBusy(true);
    const outcome = await applyOnboarding(platform, state.pairingId, profile, parsed.users);
    setBusy(false);
    if (outcome.kind === 'failed') return setProblem(outcome.message);
    if (outcome.kind !== 'done') return;
    toast(`${NAME[platform]} is set up for ${profile}`, { detail: outcome.body.needsRestart ? 'It applies when the gateway restarts.' : 'Hermes restarted the gateway for it.' });
    onDone();
  };

  return (
    <Sheet
      title={platform === 'telegram' ? 'Create a Telegram bot with a QR' : 'Pair WhatsApp with a QR'}
      detents={['full']}
      className="qr-sheet"
      onClose={close}
      footer={
        <button type="button" className="btn btn--secondary" onClick={close}>
          {live ? 'Cancel setup' : 'Close'}
        </button>
      }
    >
      {state.phase === 'preparing' && (
        <p role="status" className="qr__status">
          <Icon name="running" small /> Hermes is getting the WhatsApp bridge ready. The first time can take a minute.
        </p>
      )}
      {state.phase === 'qr' && (
        <div className="qr">
          <p className="qr__steps">
            {platform === 'telegram' ? (
              <>Scan this with your phone’s camera, or open the link below if you are on the phone you want to use. Telegram then makes the bot.</>
            ) : (
              <>On your phone open WhatsApp › Settings › Linked devices › Link a device, and scan this.</>
            )}
          </p>
          <div className="qr__frame" data-lapsed={lapsed}>
            <QrImage text={state.qr} label={`QR code to ${platform === 'telegram' ? 'create the Telegram bot' : 'link WhatsApp'}`} />
          </div>
          <p role="status" className="qr__status">
            {lapsed ? (
              <span className="mt-error">
                <Icon name="alert" small /> This QR has expired.{' '}
                <button type="button" className="btn btn--secondary btn--sm" onClick={onRestart}>
                  Start again
                </button>
              </span>
            ) : (
              <>
                <Icon name="running" small /> Waiting for you to scan{left === undefined ? '' : `. Expires in ${clock(left)}`}.
              </>
            )}
          </p>
          <div className="qr__link">
            <label htmlFor="qr-link">{platform === 'telegram' ? 'Link to open instead' : 'Pairing code'}</label>
            <input id="qr-link" className="input" readOnly value={state.link} onFocus={(event) => event.currentTarget.select()} />
            <div className="settings-actions">
              <button type="button" className="btn btn--secondary" onClick={() => void copy(state.link)}>
                <Icon name="copy" small />
                {platform === 'telegram' ? 'Copy link' : 'Copy code'}
              </button>
              {platform === 'telegram' && /^https:\/\//.test(state.link) && (
                <a className="btn btn--secondary" href={state.link} target="_blank" rel="noopener noreferrer">
                  <Icon name="external" small />
                  Open in Telegram
                </a>
              )}
            </div>
          </div>
        </div>
      )}
      {state.phase === 'linked' && (
        <form className="qr__allowed" onSubmit={save}>
          <p role="status" className="qr__status">
            <Icon name="succeeded" small /> {platform === 'telegram' ? `${state.account} was made.` : `${state.account} is linked.`}
          </p>
          <label htmlFor="qr-people">{platform === 'telegram' ? 'Telegram user ids allowed to talk to the agent' : 'Phone numbers allowed to talk to the agent'}</label>
          <input id="qr-people" className="input" value={people} onChange={(event) => setPeople(event.target.value)} inputMode={platform === 'telegram' ? 'numeric' : 'tel'} autoCapitalize="none" spellCheck={false} placeholder={platform === 'telegram' ? '123456789, 987654321' : '61400111222, 61400111333'} />
          <p className="help-text">
            These are the <Term id="allowed-users">allowed users</Term>: only they get answers. {platform === 'telegram' ? 'Your own id is filled in from the scan; add anyone else, separated by commas.' : 'Leave it empty to keep whoever Hermes already allows.'} Saving is a <Term id="risk-tiers">Tier 2</Term> action: a passkey.
          </p>
          {problem && (
            <p className="error-text" role="alert">
              {problem}
            </p>
          )}
          <WriteButton type="submit" className="btn btn--primary" disabled={busy} aria-busy={busy}>
            Save and turn on
          </WriteButton>
        </form>
      )}
      {(state.phase === 'expired' || state.phase === 'failed') && (
        <div className="qr__status" role="alert">
          <p className="mt-error">
            <Icon name={state.phase === 'expired' ? 'alert' : 'failed'} small /> {state.message}
          </p>
          <p className="help-text">{platform === 'whatsapp' ? 'Nothing was enabled. A phone that did link stays linked in Hermes’s session folder.' : 'Nothing was saved: no bot token and no platform change.'}</p>
          <button type="button" className="btn btn--primary" onClick={onRestart}>
            Start again
          </button>
        </div>
      )}
      {live && platform === 'whatsapp' && <p className="help-text">Cancelling ends the pairing. Nothing is enabled until you save who may talk to the agent.</p>}
    </Sheet>
  );
}
