// Fast chat on screen (M1 #18): the toggle in the composer and in the config sheet, the panel that replaces the transcript and the message box while Fast mode is on,
// and the guard that warns before the conversation is lost. The words live in `fast-chat.ts`; this file draws them. Nothing here is stored.
import { useBlocker } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Icon } from '../../icons.tsx';
import { useAppNavigate } from '../../shell/navigation.tsx';
import { Term } from '../../shell/Term.tsx';
import { toast } from '../../shell/toasts.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { fetchTiered } from '../../tiered.ts';
import { ModelPickerSheet } from '../models/ModelPicker.tsx';
import { applyModel, type ComposerSettings } from './ComposerChips.tsx';
import { CopyButton } from './CopyButton.tsx';
import { FastToggle } from './FastToggle.tsx';
import { discardFastConversations, fastChatOf, fastLens, hasFastConversation, setFastMode } from './fast-session.ts';
import type { FastMessage } from './fast-chat.ts';
import type { Chat } from './chat-session.ts';
import { Rich } from './Rich.tsx';
import { useStore } from './use-store.ts';
import { sendsMessage, useSendKey } from './chat-behaviour.ts';

const profileInUrl = ({ search }: { search: unknown }) => (typeof search === 'object' && search !== null && 'profile' in search ? search.profile : undefined);

/**
 * Warns before the page is left or reloaded with a fast conversation in it: nothing keeps it. Mounted by the chat whether Fast mode is on or not, since a
 * conversation outlives the switch. Leaving anyway forgets it.
 */
export function FastLeaveGuard() {
  // A sheet or dialog that opens and closes moves the history without moving the page, so only another page or another profile is leaving.
  const blocker = useBlocker({
    shouldBlockFn: ({ current, next }) => hasFastConversation() && (current.pathname !== next.pathname || profileInUrl(current) !== profileInUrl(next)),
    enableBeforeUnload: hasFastConversation,
    withResolver: true,
  });
  if (blocker.status !== 'blocked') return null;
  return (
    <div className="banner fast__leave" data-tone="warning" role="alertdialog" aria-labelledby="fast-leave-title">
      <Icon name="alert" />
      <div className="banner__content">
        <p id="fast-leave-title" className="banner__title">
          Leave this fast chat?
        </p>
        <p className="banner__body">It is not saved in Hermes history, and Caduceus keeps no copy, so it is lost when you go. Copy what you want, or continue it as a chat first.</p>
      </div>
      <div className="banner__actions">
        <button type="button" className="btn btn--primary btn--sm" autoFocus onClick={() => blocker.reset()}>
          Stay
        </button>
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          onClick={() => {
            discardFastConversations();
            blocker.proceed();
          }}
        >
          Leave and lose it
        </button>
      </div>
    </div>
  );
}

function FastBubble({ message, anchor }: { message: FastMessage; anchor: string }) {
  if (message.role === 'user') {
    return (
      <div className="chat__user">
        <div className="msg-user">
          <Rich text={message.text} anchor={anchor} />
        </div>
      </div>
    );
  }
  return (
    <div className="msg-agent">
      <Rich text={message.text} anchor={anchor} />
      <div className="msgbar">
        <CopyButton text={message.text} label="Copy reply" />
      </div>
    </div>
  );
}

/** What the panel says answers, and why that is the model. */
function modelWords(settings: ComposerSettings, hasSession: boolean): string {
  const model = settings.model;
  if (model === undefined) return 'Hermes has not said which model answers.';
  return hasSession ? `Answers with ${model}, the model of this chat.` : `Answers with ${model}, the model of the profile ${settings.profile}.`;
}

/** The conversation and message box of Fast mode, in place of the transcript and the usual composer. */
export function FastPanel({ profile, chat, settings }: { profile: string; chat: Chat | undefined; settings: ComposerSettings }) {
  const fast = useMemo(() => fastChatOf(profile), [profile]);
  const state = useStore(fast, fast.state);
  const navigate = useAppNavigate();
  const [text, setText] = useState('');
  const sendKey = useSendKey();
  const [picking, setPicking] = useState(false);
  const [continuing, setContinuing] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const session = chat?.liveSession();
  // What the first-call question names, and the session that lends its model: the chat on screen answers for both.
  useEffect(() => {
    fastLens.model = () => settings.model;
    fastLens.session = () => chat?.liveSession();
  }, [settings.model, chat]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [state.messages.length, state.waiting, state.failure]);
  useEffect(() => {
    if (!state.waiting) box.current?.focus({ preventScroll: true });
  }, [state.waiting]);

  const send = () => {
    const prompt = text.trim();
    if (prompt === '' || state.waiting) return;
    setText('');
    // A prompt that did not go (the owner declined the question, or Hermes refused) comes back to the box when nothing was written meanwhile.
    void fast.send(prompt).then((sent) => {
      if (!sent && fast.state.failure === undefined) setText((current) => (current === '' ? prompt : current));
    });
  };
  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    send();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (sendsMessage(event.nativeEvent, sendKey)) submit(event);
  };
  const continueAsChat = async () => {
    if (continuing) return;
    setContinuing(true);
    try {
      const outcome = await fast.continueAsChat({ send: fetchTiered });
      if (outcome.kind === 'failed') toast('Hermes did not save the conversation', { tone: 'danger', detail: outcome.message });
      if (outcome.kind !== 'continued') return;
      setFastMode(false);
      toast('Continued as a chat', { tone: 'success', detail: 'Hermes holds the conversation as a session now.' });
      void navigate(`/chat/${encodeURIComponent(outcome.storedId)}`);
    } finally {
      setContinuing(false);
    }
  };
  const empty = state.messages.length === 0;
  return (
    <section className="fast" aria-label="Fast chat">
      <div className="banner fast__banner" data-tone="warning" role="status">
        <Icon name="bolt" />
        <div className="banner__content">
          <p className="banner__title">Not saved in Hermes history</p>
          <p className="banner__body">
            This <Term id="fast-chat">fast chat</Term> lives only in this browser tab, so leaving or reloading loses it. It has no agent, no tools and no session.
          </p>
        </div>
      </div>
      <p className="subtle fast__model">
        {modelWords(settings, session !== undefined)}{' '}
        {session !== undefined && chat && (
          <button type="button" className="btn btn--ghost btn--sm" aria-haspopup="dialog" onClick={() => setPicking(true)}>
            Change model
          </button>
        )}
      </p>
      {picking && chat && (
        <ModelPickerSheet
          title="Model for this chat"
          profile={profile}
          {...(settings.provider && settings.model ? { value: { provider: settings.provider, model: settings.model } } : {})}
          onPick={async (choice) => {
            if (await applyModel(chat, choice)) setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      )}
      {empty && !state.waiting ? (
        <p className="subtle fast__empty">Ask anything. Each message goes to the model with the conversation so far, and the reply arrives whole.</p>
      ) : (
        <div className="fast__list" role="log" aria-label="Fast conversation" aria-live="polite">
          {state.leftOut > 0 && <p className="subtle fast__note">The earliest {state.leftOut === 1 ? 'message is' : `${state.leftOut} messages are`} too far back for one call, so {state.leftOut === 1 ? 'it was' : 'they were'} left out of the last request.</p>}
          {state.messages.map((message, index) => (
            <FastBubble key={`${index}-${message.role}`} message={message} anchor={`fast-${index}`} />
          ))}
          {state.waiting && (
            <p className="subtle" role="status">
              Waiting for the model…
            </p>
          )}
          {state.failure !== undefined && (
            <div className="banner fast__failed" data-tone="danger" role="alert">
              <Icon name="alert" />
              <div className="banner__content">
                <p className="banner__title">The model did not answer</p>
                <p className="banner__body chat__failed-error">{state.failure}</p>
              </div>
              <div className="banner__actions">
                <button type="button" className="btn btn--secondary btn--sm" onClick={() => void fast.retry()}>
                  <Icon name="refresh" small />
                  Retry
                </button>
              </div>
            </div>
          )}
          <div ref={end} />
        </div>
      )}
      <form className="chat__composer composer fast__composer" onSubmit={submit}>
        <label className="sr-only" htmlFor="fast-message">
          Message to the model
        </label>
        <textarea id="fast-message" ref={box} rows={2} value={text} placeholder="Message the model" enterKeyHint="enter" disabled={state.waiting} onChange={(event) => setText(event.target.value)} onKeyDown={onKeyDown} />
        <div className="composer__foot chat__foot">
          <FastToggle />
          <WriteButton type="button" className="btn btn--secondary btn--sm" disabled={empty || state.waiting || continuing} onClick={() => void continueAsChat()}>
            <Icon name="chat" small />
            Continue as chat
          </WriteButton>
          <button type="button" className="btn btn--ghost btn--sm" disabled={empty || state.waiting} onClick={() => fast.clear()}>
            <Icon name="trash" small />
            Clear
          </button>
          <button type="submit" className="btn btn--primary" disabled={text.trim() === '' || state.waiting}>
            <Icon name="send" />
            Send
          </button>
        </div>
      </form>
    </section>
  );
}
