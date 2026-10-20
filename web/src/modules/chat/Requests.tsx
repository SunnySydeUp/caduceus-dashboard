// What Hermes waits for the owner to decide (M1 #06): an approval (may this tool call go ahead?) and a clarify question, as cards above the
// composer. On a large screen the card is inline and Enter means Allow once; on a phone a bar above the composer opens it as a bottom sheet
// that stays above the keyboard, with Allow once at the thumb and Deny a step away. The state is the chat engine's (`state.requests`).
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Icon } from '../../icons.tsx';
import { Sheet } from '../../overlays/Sheet.tsx';
import { Term } from '../../shell/Term.tsx';
import { useSizeClass } from '../../shell/use-size-class.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import type { Chat, ChatState } from './chat-session.ts';
import { clarifyDeadline, countdownOf, toolBehind, type ApprovalDecision, type ApprovalRequest, type ClarifyQuestion, type ClarifyRequest } from './requests.ts';

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

interface CardProps {
  chat: Chat | undefined;
  state: ChatState;
  /** The card is in the bottom sheet (a phone), not inline. */
  inSheet: boolean;
}

function ApprovalCard({ request, chat, state, inSheet }: CardProps & { request: ApprovalRequest }) {
  const titleId = useId();
  const reasonId = useId();
  const root = useRef<HTMLElement>(null);
  const [denying, setDenying] = useState(false);
  const [reason, setReason] = useState('');
  const busy = request.status === 'sending';
  const running = toolBehind(state.turn?.segments);
  const tool = request.tool ?? running?.name;
  const others = running?.args === undefined ? [] : Object.entries(running.args).filter(([key]) => key !== 'command');
  const decide = (decision: ApprovalDecision) => {
    if (!busy) void chat?.answerApproval(request.id, decision);
  };

  // Inline, the card takes focus when it arrives (unless the owner is typing a message), and Enter is Allow once.
  useEffect(() => {
    if (inSheet) return;
    const active = document.activeElement;
    if (active === document.body || (active instanceof HTMLTextAreaElement && active.value === '')) root.current?.focus({ preventScroll: true });
    root.current?.scrollIntoView({ block: 'nearest' });
  }, [inSheet, request.id]);
  useEffect(() => {
    if (inSheet || denying || busy) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || event.isComposing || event.defaultPrevented || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return;
      // A control keeps its own Enter, and a dialog on top (a passkey prompt, say) is not about this card.
      if ((event.target instanceof Element && event.target.closest('a, button, input, textarea, select, summary, [contenteditable], [role="button"], [role="switch"], [role="radio"], [role="tab"]')) || document.querySelector('.layer')) return;
      event.preventDefault();
      void chat?.answerApproval(request.id, { choice: 'once' });
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [inSheet, denying, busy, chat, request.id]);

  const offered = (choice: ApprovalDecision['choice']) => request.choices.includes(choice);
  const Heading = inSheet ? 'h3' : 'h2';
  return (
    <section ref={root} className="approval cx-apr" data-sheet={inSheet ? '' : undefined} role={inSheet ? undefined : 'alertdialog'} aria-modal={inSheet ? undefined : false} aria-labelledby={titleId} tabIndex={-1} data-apr={request.id}>
      <div className="approval__head">
        <p className="cx-apr__kind">
          <Icon name="waiting" small />
          <Term id="approval">Approval needed</Term>
        </p>
        {state.requests.length > 1 && <span className="subtle cx-apr__meta">{state.requests.length - 1} more waiting</span>}
      </div>
      <Heading className="cx-apr__q" id={titleId}>
        {tool ? (
          <>
            Allow <span className="mono">{tool}</span> {request.command ? 'to run this command?' : 'to go ahead?'}
          </>
        ) : (
          'Allow this to run?'
        )}
      </Heading>
      {request.command && (
        <pre className="log cx-apr__cmd" aria-label="Command">
          {request.command}
        </pre>
      )}
      <dl className="cx-apr__kv">
        {state.cwd && (
          <div>
            <dt>cwd</dt>
            <dd className="mono">{state.cwd}</dd>
          </div>
        )}
        {request.description && (
          <div>
            <dt>rule</dt>
            <dd>{request.description}</dd>
          </div>
        )}
      </dl>
      {others.length > 0 && (
        <details className="cx-apr__args">
          <summary>Arguments</summary>
          <pre className="log">{JSON.stringify(Object.fromEntries(others), null, 2)}</pre>
        </details>
      )}
      {request.error && (
        <p className="field__error" role="alert">
          <Icon name="alert" small />
          {request.error}
        </p>
      )}
      <div className="approval__actions cx-apr__acts">
        <WriteButton type="button" className="btn btn--primary" data-act="once" disabled={busy} aria-keyshortcuts={inSheet ? undefined : 'Enter'} onClick={() => decide({ choice: 'once' })}>
          <Icon name="check" />
          Allow once
          {!inSheet && <kbd className="cx-kbd">↵</kbd>}
        </WriteButton>
        {offered('session') && (
          <WriteButton type="button" className="btn btn--secondary" data-act="session" disabled={busy} onClick={() => decide({ choice: 'session' })}>
            Allow for this session
          </WriteButton>
        )}
        {offered('always') && (
          <WriteButton type="button" className="btn btn--secondary" data-act="always" disabled={busy} onClick={() => decide({ choice: 'always' })}>
            <Icon name="fingerprint" />
            Allow always
          </WriteButton>
        )}
        <button type="button" className="btn btn--danger-quiet" data-act="deny" aria-expanded={denying} aria-controls={reasonId} disabled={busy} onClick={() => setDenying((open) => !open)}>
          Deny…
        </button>
      </div>
      {denying && (
        <div className="cx-deny" id={reasonId}>
          <div className="field">
            <label className="field__label" htmlFor={`${reasonId}-text`}>
              Reason for denying (optional)
            </label>
            <textarea className="input" id={`${reasonId}-text`} rows={2} value={reason} autoFocus placeholder="e.g. Use a different folder" onChange={(event) => setReason(event.target.value)} />
            <p className="field__help">Sent to the agent so it can choose another way. The command does not run.</p>
          </div>
          <div className="cx-deny__acts">
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setDenying(false)}>
              Back
            </button>
            <WriteButton type="button" className="btn btn--danger btn--sm" data-act="deny-confirm" disabled={busy} onClick={() => decide({ choice: 'deny', reason })}>
              Deny{reason.trim() ? ' with reason' : ''}
            </WriteButton>
          </div>
        </div>
      )}
    </section>
  );
}

/** One question of a clarify card: its choices as chips, and a field for an answer in the owner's own words. */
function QuestionFields({ question, picked, typed, onPick, onType, busy, single, autoFocus }: {
  question: ClarifyQuestion;
  picked: readonly string[];
  typed: string;
  onPick(choice: string): void;
  onType(text: string): void;
  busy: boolean;
  /** The only question: choosing a choice answers it at once, and there is no separate send for the choices. */
  single: boolean;
  autoFocus: boolean;
}) {
  const id = useId();
  return (
    <div className="cx-question">
      <p className="cx-question__text" id={`${id}-q`}>
        {question.question}
      </p>
      {question.multiSelect && <p className="field__help">Pick one or more.</p>}
      {question.choices.length > 0 && (
        <div className="cx-choices" role="group" aria-labelledby={`${id}-q`}>
          {question.choices.map((choice, index) => (
            <button
              key={choice}
              type="button"
              className="chip"
              aria-pressed={question.multiSelect || !single ? picked.includes(choice) : undefined}
              disabled={busy}
              autoFocus={autoFocus && index === 0}
              onClick={() => onPick(choice)}
            >
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

function ClarifyCard({ request, chat, state, inSheet }: CardProps & { request: ClarifyRequest }) {
  const titleId = useId();
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [typed, setTyped] = useState<Record<string, string>>({});
  const busy = request.status === 'sending';
  const deadline = clarifyDeadline(request, state.clarifyTimeoutS);
  const now = useNow(deadline !== undefined);
  const left = deadline === undefined ? undefined : countdownOf(deadline, now);
  const [only] = request.questions;
  const single = request.questions.length === 1 && !only?.multiSelect;

  const answer = (): Record<string, string | string[]> =>
    Object.fromEntries(request.questions.map((question) => [question.qid, typed[question.qid]?.trim() || (question.multiSelect ? (picked[question.qid] ?? []) : (picked[question.qid]?.[0] ?? ''))]));
  const send = (answers: Record<string, string | string[]>) => {
    if (!busy) void chat?.answerClarify(request.id, answers);
  };
  const pick = (question: ClarifyQuestion, choice: string) => {
    // One question with single choices: the choice is the answer.
    if (single) return send({ [question.qid]: choice });
    setTyped((now) => ({ ...now, [question.qid]: '' }));
    setPicked((now) => {
      const had = now[question.qid] ?? [];
      return { ...now, [question.qid]: question.multiSelect ? (had.includes(choice) ? had.filter((entry) => entry !== choice) : [...had, choice]) : [choice] };
    });
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    send(answer());
  };
  const ready = Object.values(answer()).some((given) => (Array.isArray(given) ? given.length > 0 : given !== ''));
  const Heading = inSheet ? 'h3' : 'h2';

  return (
    <section className="approval cx-apr cx-clar" data-sheet={inSheet ? '' : undefined} role={inSheet ? undefined : 'alertdialog'} aria-modal={inSheet ? undefined : false} aria-labelledby={titleId} tabIndex={-1} data-clar={request.id}>
      <div className="approval__head">
        <p className="cx-apr__kind">
          <Icon name="waiting" small />
          <Term id="clarify">Question for you</Term>
        </p>
        {left && (
          <span className="cx-count mono" role="timer" aria-label={left.lapsed ? 'The wait is over' : `Time left: ${left.label}`} title="Time left before Hermes carries on without an answer">
            <Icon name="clock" small />
            <span>{left.lapsed ? 'Hermes is moving on…' : left.label}</span>
          </span>
        )}
      </div>
      <Heading className="cx-apr__q" id={titleId}>
        {request.questions.length > 1 ? 'Hermes has some questions' : only?.question}
      </Heading>
      <p className="cx-apr__desc">If nobody answers, Hermes carries on without one.</p>
      {request.error && (
        <p className="field__error" role="alert">
          <Icon name="alert" small />
          {request.error}
        </p>
      )}
      <form className="cx-clar__form" onSubmit={submit}>
        {request.questions.map((question, index) =>
          single ? (
            <div key={question.qid} className="cx-question">
              {question.choices.length > 0 && (
                <div className="cx-choices" role="group" aria-label="Suggested answers">
                  {question.choices.map((choice, at) => (
                    <button key={choice} type="button" className="chip" disabled={busy} autoFocus={!inSheet && at === 0} onClick={() => pick(question, choice)}>
                      {choice}
                    </button>
                  ))}
                </div>
              )}
              <div className="cx-clar__free">
                <label className="sr-only" htmlFor={`${titleId}-free`}>
                  Answer in your own words
                </label>
                <input className="input" id={`${titleId}-free`} value={typed[question.qid] ?? ''} placeholder={question.choices.length > 0 ? 'Or type your own answer…' : 'Type your answer…'} autoComplete="off" disabled={busy} onChange={(event) => setTyped((now) => ({ ...now, [question.qid]: event.target.value }))} />
                <WriteButton type="submit" className="btn btn--primary" disabled={busy || !ready}>
                  Send
                </WriteButton>
              </div>
            </div>
          ) : (
            <QuestionFields
              key={question.qid}
              question={question}
              picked={picked[question.qid] ?? []}
              typed={typed[question.qid] ?? ''}
              busy={busy}
              single={false}
              autoFocus={false}
              onPick={(choice) => pick(question, choice)}
              onType={(text) => {
                setTyped((now) => ({ ...now, [question.qid]: text }));
                if (text !== '') setPicked((now) => ({ ...now, [question.qid]: [] }));
              }}
            />
          ),
        )}
        {!single && (
          <div className="cx-clar__send">
            <WriteButton type="submit" className="btn btn--primary" disabled={busy || !ready}>
              Send answer
            </WriteButton>
          </div>
        )}
      </form>
      <div className="cx-clar__skip">
        <WriteButton type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => send({})}>
          Skip
        </WriteButton>
      </div>
    </section>
  );
}

/** The notes of requests that closed without the owner: answered elsewhere, time ran out, withdrawn. */
function SettledNotes({ chat, state }: { chat: Chat | undefined; state: ChatState }) {
  return (
    <>
      {state.settled.map((note) => (
        <div key={note.id} className="banner cx-settled" data-tone={note.outcome === 'answered-elsewhere' ? 'info' : 'warning'} role="status">
          <Icon name={note.outcome === 'answered-elsewhere' ? 'check' : 'clock'} />
          <span className="banner__content">
            <strong>{note.kind === 'approval' ? 'Approval' : 'Question'}: </strong>
            {note.text}
          </span>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => chat?.dismissSettled(note.id)}>
            Dismiss
          </button>
        </div>
      ))}
    </>
  );
}

/** What Hermes is waiting for, above the composer: the oldest request as a card, the rest behind it, and how closed ones ended. `children` ride in the same sticky stack, below the cards (the decide-anywhere tray). */
export function PendingRequests({ chat, state, children }: { chat: Chat | undefined; state: ChatState; children?: ReactNode }) {
  const compact = useSizeClass() === 'compact';
  const current = state.requests[0];
  // On a phone the card is a sheet that opens by itself when a request arrives; closing it leaves the bar to open it again.
  const [away, setAway] = useState<string>();
  const sheetOpen = compact && current !== undefined && away !== current.id;

  return (
    <div className="cx-cards">
      <SettledNotes chat={chat} state={state} />
      {current &&
        (compact ? (
          <>
            <div className="cx-pend" data-tone="warning">
              <Icon name="waiting" />
              <div className="cx-pend__text">
                <strong>{current.kind === 'approval' ? 'Approval needed' : 'Question for you'}</strong>
                <span className="truncate">{current.kind === 'approval' ? <code>{current.command || 'A tool call'}</code> : current.questions[0]?.question}</span>
              </div>
              <button type="button" className="btn btn--primary btn--sm" onClick={() => setAway(undefined)}>
                Review
              </button>
            </div>
            {sheetOpen && (
              <Sheet title={current.kind === 'approval' ? 'Approval needed' : 'Question for you'} className="cx-pendsheet" initialFocus={current.kind === 'approval' ? '[data-act="once"]' : '[data-body] button, [data-body] input'} onClose={() => setAway(current.id)}>
                {current.kind === 'approval' ? <ApprovalCard request={current} chat={chat} state={state} inSheet /> : <ClarifyCard request={current} chat={chat} state={state} inSheet />}
              </Sheet>
            )}
          </>
        ) : current.kind === 'approval' ? (
          <ApprovalCard key={current.id} request={current} chat={chat} state={state} inSheet={false} />
        ) : (
          <ClarifyCard key={current.id} request={current} chat={chat} state={state} inSheet={false} />
        ))}
      {children}
    </div>
  );
}
