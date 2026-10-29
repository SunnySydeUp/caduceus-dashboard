// The decision on one Inbox item (M2 #01): the same typed answers the chat's approval card gives (Allow once, for this session, always, Deny with
// a reason) and the same question card (choices, free text, a countdown), over an item that may belong to any chat in any profile. In the bottom
// sheet on a phone, in the detail pane beside the list elsewhere. The answer goes to Caduceus (`inbox-actions.ts`), which gives it to Hermes.
import { useEffect, useId, useState, type FormEvent } from 'react';
import type { InboxApproval, InboxClarify, InboxDecision as Decision, InboxItem, InboxNotice, InboxQuestion } from '@caduceus/contracts/inbox';
import { Icon } from '../../icons.tsx';
import { AppLink } from '../../shell/navigation.tsx';
import { Term } from '../../shell/Term.tsx';
import { toast } from '../../shell/toasts.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { countdownOf } from '../chat/requests.ts';
import { decideItem, type DecisionOutcome } from './inbox-actions.ts';
import { useNoticeActions } from './NoticeActions.tsx';
import { ageWords, clarifyAnswer, type ClarifyResult } from './inbox-model.ts';
import './inbox.css';

/** The page's clock in ms, ticking each second while `active`. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [active]);
  return now;
}

/** Sends a decision and says what became of it; `error` is why the last one did not go, in words. */
export function useDecision(item: InboxItem, onDone?: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  // Another item, another answer in flight.
  useEffect(() => {
    setBusy(false);
    setError(undefined);
  }, [item.id]);
  const decide = async (decision: Decision) => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    let outcome: DecisionOutcome;
    try {
      outcome = await decideItem(item, decision);
    } catch (failure) {
      outcome = { kind: 'failed', message: failure instanceof Error ? failure.message : String(failure) };
    }
    setBusy(false);
    // Once Hermes has the answer, or is no longer asking, there is nothing left to decide here.
    if (outcome.kind === 'resolved' || outcome.kind === 'already-answered') onDone?.();
    if (outcome.kind === 'resolved') {
      if (!('choice' in decision)) {
        const skipped = Object.values(decision.result.answers).every((given) => given === '');
        toast(skipped ? 'Skipped' : 'Answer sent', { tone: 'success', detail: skipped ? 'The agent carries on without an answer.' : 'The agent carries on with your answer.' });
      } else if (decision.choice === 'deny') toast('Denied', { tone: 'success', detail: 'The command does not run. The agent is told, and can try another way.' });
      else toast(decision.choice === 'always' ? 'Allowed always' : 'Allowed', { tone: 'success', detail: 'The agent carries on.' });
    } else if (outcome.kind === 'already-answered') toast('Already answered elsewhere', { tone: 'info', detail: 'Hermes was no longer waiting for this one.' });
    else if (outcome.kind === 'failed') setError(outcome.message);
  };
  return { busy, error, decide };
}

function Where({ item }: { item: InboxApproval | InboxClarify }) {
  const now = useNow(true);
  return (
    <dl className="ib-kv">
      <div>
        <dt>Profile</dt>
        <dd>{item.profile ?? 'unknown'}</dd>
      </div>
      <div>
        <dt>Session</dt>
        <dd>{item.storedSessionId ? <AppLink to={`/chat/${encodeURIComponent(item.storedSessionId)}`}>{item.sessionTitle}</AppLink> : item.sessionTitle}</dd>
      </div>
      <div>
        <dt>Asked</dt>
        <dd>{ageWords(item.at, now)}</dd>
      </div>
    </dl>
  );
}

function ApprovalDecision({ item, onDone }: { item: InboxApproval; onDone?: () => void }) {
  const reasonId = useId();
  const [denying, setDenying] = useState(false);
  const [reason, setReason] = useState('');
  const { busy, error, decide } = useDecision(item, onDone);
  const offered = (choice: InboxApproval['choices'][number]) => item.choices.includes(choice);
  useEffect(() => {
    setDenying(false);
    setReason('');
  }, [item.id]);
  return (
    <section className="ib-decision" aria-labelledby={`${reasonId}-title`} data-inbox-item={item.id}>
      <p className="ib-kind">
        <Icon name="waiting" small />
        <Term id="approval">Approval needed</Term>
      </p>
      <h2 className="ib-decision__q" id={`${reasonId}-title`}>
        {item.tool ? (
          <>
            Allow <span className="mono">{item.tool}</span> to run this command?
          </>
        ) : (
          'Allow this command to run?'
        )}
      </h2>
      {item.command && (
        <pre className="log ib-cmd" aria-label="Command">
          {item.command}
        </pre>
      )}
      {item.description && <p className="ib-rule">Why Hermes asks: {item.description}</p>}
      <Where item={item} />
      {error && (
        <p className="field__error" role="alert">
          <Icon name="alert" small />
          {error}
        </p>
      )}
      <div className="ib-acts">
        <WriteButton type="button" className="btn btn--primary" data-act="once" disabled={busy} onClick={() => void decide({ choice: 'once' })}>
          <Icon name="check" />
          Allow once
        </WriteButton>
        {offered('session') && (
          <WriteButton type="button" className="btn btn--secondary" data-act="session" disabled={busy} onClick={() => void decide({ choice: 'session' })}>
            Allow for this session
          </WriteButton>
        )}
        {offered('always') && (
          <WriteButton type="button" className="btn btn--secondary" data-act="always" disabled={busy} onClick={() => void decide({ choice: 'always' })}>
            <Icon name="fingerprint" />
            <span className="ib-stacked">
              Allow always
              <small>Needs passkey</small>
            </span>
          </WriteButton>
        )}
        <button type="button" className="btn btn--danger-quiet" data-act="deny" aria-expanded={denying} aria-controls={reasonId} disabled={busy} onClick={() => setDenying((open) => !open)}>
          Deny…
        </button>
      </div>
      {denying && (
        <div className="ib-deny" id={reasonId}>
          <div className="field">
            <label className="field__label" htmlFor={`${reasonId}-text`}>
              Reason for denying (optional)
            </label>
            <textarea className="input" id={`${reasonId}-text`} rows={2} value={reason} autoFocus placeholder="e.g. Use a different folder" onChange={(event) => setReason(event.target.value)} />
            <p className="field__help">Sent to the agent so it can choose another way. The command does not run.</p>
          </div>
          <div className="ib-deny__acts">
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setDenying(false)}>
              Back
            </button>
            <WriteButton type="button" className="btn btn--danger btn--sm" data-act="deny-confirm" disabled={busy} onClick={() => void decide({ choice: 'deny', reason })}>
              Deny{reason.trim() ? ' with reason' : ''}
            </WriteButton>
          </div>
        </div>
      )}
    </section>
  );
}

/** One question: its choices as chips, and a field for an answer in the owner's own words. */
function QuestionFields({ question, picked, typed, busy, onPick, onType }: { question: InboxQuestion; picked: readonly string[]; typed: string; busy: boolean; onPick(choice: string): void; onType(text: string): void }) {
  const id = useId();
  return (
    <div className="ib-question">
      <p className="ib-question__text" id={`${id}-q`}>
        {question.question}
      </p>
      {question.multiSelect && <p className="field__help">Pick one or more.</p>}
      {question.choices.length > 0 && (
        <div className="ib-choices" role="group" aria-labelledby={`${id}-q`}>
          {question.choices.map((choice) => (
            <button key={choice} type="button" className="chip" aria-pressed={picked.includes(choice)} disabled={busy} onClick={() => onPick(choice)}>
              {choice}
            </button>
          ))}
        </div>
      )}
      <label className="sr-only" htmlFor={`${id}-free`}>
        Answer in your own words
      </label>
      <input className="input" id={`${id}-free`} value={typed} placeholder={question.choices.length > 0 ? 'Or type your own answer…' : 'Type your answer…'} autoComplete="off" disabled={busy} onChange={(event) => onType(event.target.value)} />
    </div>
  );
}

function ClarifyDecision({ item, onDone }: { item: InboxClarify; onDone?: () => void }) {
  const titleId = useId();
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [typed, setTyped] = useState<Record<string, string>>({});
  const { busy, error, decide } = useDecision(item, onDone);
  useEffect(() => {
    setPicked({});
    setTyped({});
  }, [item.id]);
  const now = useNow(item.expiresAt !== undefined);
  const left = item.expiresAt === undefined ? undefined : countdownOf(item.expiresAt, now);
  const [only] = item.questions;
  /** One question with single choices: a tap on a choice is the answer. */
  const single = item.questions.length === 1 && !only?.multiSelect;

  const send = (answer: ClarifyResult) => void decide({ result: answer });
  const pick = (question: InboxQuestion, choice: string) => {
    if (single) return send(clarifyAnswer(item, { [question.qid]: [choice] }, {}));
    setTyped((now) => ({ ...now, [question.qid]: '' }));
    setPicked((now) => {
      const had = now[question.qid] ?? [];
      return { ...now, [question.qid]: question.multiSelect ? (had.includes(choice) ? had.filter((entry) => entry !== choice) : [...had, choice]) : [choice] };
    });
  };
  const answer = clarifyAnswer(item, picked, typed);
  const ready = Object.values(answer.answers).some((given) => given !== '');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (ready) send(answer);
  };

  return (
    <section className="ib-decision" aria-labelledby={titleId} data-inbox-item={item.id}>
      <div className="ib-decision__head">
        <p className="ib-kind">
          <Icon name="waiting" small />
          <Term id="clarify">Question for you</Term>
        </p>
        {left && (
          <span className="ib-count mono" role="timer" aria-label={left.lapsed ? 'The wait is over' : `Time left: ${left.label}`} title="Time left before Hermes carries on without an answer">
            <Icon name="clock" small />
            <span>{left.lapsed ? 'Hermes is moving on…' : left.label}</span>
          </span>
        )}
      </div>
      <h2 className="ib-decision__q" id={titleId}>
        {item.questions.length > 1 ? 'Hermes has some questions' : only?.question}
      </h2>
      <p className="ib-rule">If nobody answers, Hermes carries on without one.</p>
      <Where item={item} />
      {error && (
        <p className="field__error" role="alert">
          <Icon name="alert" small />
          {error}
        </p>
      )}
      <form className="ib-form" onSubmit={submit}>
        {single ? (
          <div className="ib-question">
            {only && only.choices.length > 0 && (
              <div className="ib-choices" role="group" aria-label="Suggested answers">
                {only.choices.map((choice) => (
                  <button key={choice} type="button" className="chip" disabled={busy} onClick={() => pick(only, choice)}>
                    {choice}
                  </button>
                ))}
              </div>
            )}
            <div className="ib-free">
              <label className="sr-only" htmlFor={`${titleId}-free`}>
                Answer in your own words
              </label>
              <input className="input" id={`${titleId}-free`} value={typed[only?.qid ?? ''] ?? ''} placeholder={only && only.choices.length > 0 ? 'Or type your own answer…' : 'Type your answer…'} autoComplete="off" disabled={busy} onChange={(event) => setTyped({ [only?.qid ?? '']: event.target.value })} />
              <WriteButton type="submit" className="btn btn--primary" disabled={busy || !ready}>
                Send
              </WriteButton>
            </div>
          </div>
        ) : (
          <>
            {item.questions.map((question) => (
              <QuestionFields
                key={question.qid}
                question={question}
                picked={picked[question.qid] ?? []}
                typed={typed[question.qid] ?? ''}
                busy={busy}
                onPick={(choice) => pick(question, choice)}
                onType={(text) => {
                  setTyped((now) => ({ ...now, [question.qid]: text }));
                  if (text !== '') setPicked((now) => ({ ...now, [question.qid]: [] }));
                }}
              />
            ))}
            <div className="ib-acts">
              <WriteButton type="submit" className="btn btn--primary" disabled={busy || !ready}>
                Send answer
              </WriteButton>
            </div>
          </>
        )}
      </form>
      <div className="ib-skip">
        <WriteButton type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => send(clarifyAnswer(item, {}, {}))}>
          Skip
        </WriteButton>
      </div>
    </section>
  );
}

/** A notice in full: what it says, what can be done about it at once, and where to look. */
function NoticeDetail({ item, embedded }: { item: InboxNotice; embedded?: boolean }) {
  const [error, setError] = useState<string>();
  const actions = useNoticeActions(setError);
  const busy = actions.busy;
  useEffect(() => setError(undefined), [item.id]);
  return (
    <section className="ib-decision" aria-label={item.title} data-inbox-item={item.id}>
      {!embedded && <h2 className="ib-decision__q">{item.title}</h2>}
      {item.detail && <p className="ib-rule">{item.detail}</p>}
      {!embedded && item.profile && <p className="ib-rule">Profile: {item.profile}</p>}
      {error && (
        <p className="field__error" role="alert">
          <Icon name="alert" small />
          {error}
        </p>
      )}
      <div className="ib-acts">
        {item.actions.map((action) => (
          <WriteButton key={action.id} type="button" className={`btn ${action.primary ? 'btn--primary' : 'btn--secondary'}`} data-act={action.id} disabled={busy !== undefined} onClick={() => actions.run(action, { title: item.title, quote: item.detail, profile: item.profile })}>
            {action.label}…
          </WriteButton>
        ))}
        {item.link && (
          <AppLink className="btn btn--ghost" to={item.link.to}>
            {item.link.label}
          </AppLink>
        )}
      </div>
      {actions.sheet}
    </section>
  );
}

/** The decision on `item`, whatever it is: an approval or a question, or a notice in full. `embedded`: in a card that already says what it is about. `onDone` hears that the answer went (or that Hermes no longer asked). */
export function InboxDecision({ item, onDone, embedded }: { item: InboxItem; onDone?: () => void; embedded?: boolean }) {
  if (item.kind === 'notice') return <NoticeDetail item={item} embedded={embedded} />;
  return item.kind === 'approval' ? <ApprovalDecision item={item} onDone={onDone} /> : <ClarifyDecision item={item} onDone={onDone} />;
}
