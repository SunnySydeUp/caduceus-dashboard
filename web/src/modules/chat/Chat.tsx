import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type FormEvent, type KeyboardEvent, type Ref } from 'react';
import { useParams, useSearch } from '@tanstack/react-router';
import { gatewayConnection } from '../../gateway.ts';
import { Icon } from '../../icons.tsx';
import { Sheet } from '../../overlays/Sheet.tsx';
import { useReadOnly } from '../../policy-state.ts';
import { useAssistantName } from '../../profile-preferences.ts';
import { AppLink, useAppNavigate, useRouteInfo } from '../../shell/navigation.tsx';
import { PageHeader } from '../../shell/PageHeader.tsx';
import { useProfileScope } from '../../shell/profile-context.tsx';
import { Term } from '../../shell/Term.tsx';
import { toast } from '../../shell/toasts.ts';
import { confirmTier } from '../../shell/tier-confirmation.ts';
import { useSizeClass } from '../../shell/use-size-class.ts';
import { terminalModeOffered } from '../terminal/terminal-model.ts';
import { shownActivity, type ActivityMode } from './activity.ts';
import { askStepUp } from '../../passkeys.ts';
import { chooseActivityMode, useActivityMode } from './activity-mode.ts';
import { ComposerBanner, useComposerSettings, type ComposerSettings } from './ComposerChips.tsx';
import { ComposerBar } from './ComposerBar.tsx';
import { DraftNotes, WaitingDraftHint } from './DraftNotes.tsx';
import { useDraft } from './use-draft.ts';
import { insertAtCaret } from './saved-prompts.ts';
import type { PromptsAccess } from './Prompts.tsx';
import { ContextPanel, openWork } from './ContextPanel.tsx';
import { AgentContext } from './ActivityCards.tsx';
import { TalkDetails } from './TalkDetails.tsx';
import { TalkHeader } from './TalkHeader.tsx';
import { DETAILS_ID, DETAILS_SHEET_ID, DetailsPanel } from './DetailsPanel.tsx';
import { chatState, threadMenu, type ThreadActionId } from './talk-header.ts';
import { setPinnedWithinLimit, useSessionFlags } from './use-session-flags.ts';
import { LatestSession } from './LatestSession.tsx';
import { setDetailsOpen, useDetailsLayout, useDetailsOpen } from './talk-prefs.ts';
import { TALK_SCOPE } from './talk-sessions.ts';
import type { WorkspaceView } from './talk-details.ts';
import { useCrew } from '../crew/use-crew.ts';
import './talk.css';
import { createChat, transcriptOf, type Chat as ChatEngine, type ChatMessage, type ChatState } from './chat-session.ts';
import { Outline } from './Outline.tsx';
import { SessionsPane } from './SessionsPane.tsx';
import { useStore } from './use-store.ts';
import { FastLeaveGuard, FastPanel } from './FastChat.tsx';
import { fastMode } from './fast-session.ts';
import { PendingRequests } from './Requests.tsx';
import { DecideTray } from './DecideTray.tsx';
import { useReviewOpened } from './use-review-opened.ts';
import { RunStatus } from './RunControl.tsx';
import { runCommandOf, type RunCommand } from './run-command.ts';
import { looksLikeSlashCommand } from '@caduceus/contracts/hermes/shared/slash';
import { ComposerMenuView, useComposerMenu } from './ComposerMenu.tsx';
import { CommandNotes } from './CommandNotes.tsx';
import { AttachmentChips, AttachmentNotes } from './ComposerAttachments.tsx';
import { collapsePaste, keepInline, MAX_ATTACHMENTS, type Candidate, type Problem } from './attachments.ts';
import { useAttachments } from './use-attachments.ts';
import { splitAttachments } from './message-attachments.ts';
import { HandsFreePanel } from '../voice/HandsFree.tsx';
import { VoiceStrip } from '../voice/VoiceControls.tsx';
import { dictate } from '../voice/dictation-text.ts';
import { initialPress, type PressState } from '../voice/hold-to-talk.ts';
import { handsFree, useHandsFree } from '../voice/hands-free-session.ts';
import { ReadAloudBar } from '../voice/ReadAloudBar.tsx';
import { useVoiceInput } from '../voice/use-voice-input.ts';
import { readReply } from '../voice/read-aloud-store.ts';
import { useFinishedReply } from '../voice/use-finished-reply.ts';
import { useVoicePrefs, voicePrefsNow } from '../voice/voice-prefs.ts';
import { SelectionActions } from './SelectionActions.tsx';
import { refinePrompt, replyWithSelection, type Refinement } from './selection-actions.ts';
import { takeLearn } from './learn-handoff.ts';
import { offerBrief } from '../work/brief-handoff.ts';
import { clearSchedule, offerSchedule } from '../work/schedule-handoff.ts';
import { forgetRepeat, repeatLeftover, rememberRepeat } from './repeat-handoff.ts';
import { IntentChip } from './ComposerIntent.tsx';
import { intentAfter, planDraft, type Intent } from './composer-intent.ts';
import { prefillFromMessage, prefillFromSession } from '../work/brief-prefill.ts';
import { createOutlineBuilder, type OutlineEntry } from './outline.ts';
import { Transcript, type JumpRequest, type TranscriptItem } from './Transcript.tsx';
import { CardControlContext } from './ActivityCards.tsx';
import { FindBar, TranscriptView } from './TranscriptView.tsx';
import { useTranscriptTools } from './use-transcript-tools.ts';
import { locateHit, type HitSpot } from './session-search.ts';
import { HandoffNote, ReadOnlyBar, SegmentsBar, SourceTag } from './SessionNotices.tsx';
import { useLineage, useSessionAccess, type SessionAccessState } from './use-session-access.ts';
import { SessionGone } from './SessionGone.tsx';
import { Loading } from '../../shell/Loading.tsx';
import { generateSummary, summaryRequest } from './handoff-summary.ts';
import { readHermes } from './read-hermes.ts';
import { filterItems, ROLES, transcriptText, type CopyFormat } from './transcript-tools.ts';
import { EditSheet, InterruptedNotice } from './MessageActions.tsx';
import { ExportSheet } from './ExportImport.tsx';
import { ShareSheet } from '../shares/ShareSheet.tsx';
import { afterSheet, RenameSheet, report, useSessionActions } from './SessionOrganiser.tsx';
import { copyText } from './clipboard.ts';
import { editableText, plainText, removedByEdit, type MessageActionId } from './message-actions.ts';
import { closeAllLayers } from '../../overlays/layers.ts';
import { offerPrefill, takePrefill } from './prefill-handoff.ts';
import { useNewChatStart } from './use-new-chat-start.ts';
import { NewChatStart } from './NewChatStart.tsx';
import { WorktreeBar } from './Worktree.tsx';
import { interruptionOf } from './turn-recovery.ts';
import type { SessionItem } from './sessions-model.ts';
import { CADUCEUS_SESSION_SOURCE } from '@caduceus/contracts/caduceus-api';
import { NEW_CHAT } from '@caduceus/contracts/chat-drafts';
import './chat.css';
import { loadChatBehaviour, playCompletionSound, sendsMessage, useChatBehaviour, useSendKey } from './chat-behaviour.ts';

const NO_CHAT: ChatState = { storedId: undefined, messages: [], turn: undefined, running: false, title: undefined, syncing: false, catchingUp: false, error: undefined, hasOlder: false, hasNewer: false, loadingMore: false, focusId: undefined, todos: [], subagents: [], usage: undefined, yolo: false, cwd: undefined, model: undefined, provider: undefined, reasoning: undefined, requests: [], settled: [], clarifyTimeoutS: 3600, steers: [], queue: [], queuePaused: false, sideTasks: [], goal: undefined, notes: [], forkedFrom: undefined, readOnly: false };

/** A hands-free conversation that stopped because something went wrong says why. */
const handsFreeEnded = (reason: string | undefined): void => {
  if (reason) toast('Hands-free stopped', { tone: 'danger', detail: reason });
};

/** What a failed call says in a toast: Hermes's own words. */
const refused = (title: string) => (error: unknown): void => {
  toast(title, { tone: 'danger', detail: error instanceof Error ? error.message : String(error) });
};

/** Reply with selection: the words to quote, and a nonce so that quoting the same words twice is two requests. */
interface QuoteRequest {
  text: string;
  nonce: number;
}

/**
 * The message box. Idle, it has Send; while Hermes is answering it has three ways to go on: Steer (redirect the turn), Queue (run after it) and Stop.
 * They sit side by side, not in a menu, so that each is one tap on a phone. `/btw`, `/background` and `/goal` run beside the turn whichever is pressed.
 * Enter sends on a device with a fine pointer and ⌘/Ctrl+Enter on touch, unless the owner chose a key; ⌘/Ctrl+Enter also steers while Hermes is answering. Shift+Enter is always a new line.
 */
function Composer({ chat, state, formRef, settings, reply, prefill, session }: { chat: ChatEngine | undefined; state: ChatState; formRef: Ref<HTMLFormElement>; settings: ComposerSettings; reply: QuoteRequest | undefined; prefill: QuoteRequest | undefined; session: string }) {
  const [text, setText] = useState('');
  /** What the next message is for (Ask, Delegate, Repeat). It belongs to one message and goes back to Ask once that message is dealt with. */
  const [intent, setIntent] = useState<Intent>('ask');
  const navigate = useAppNavigate();
  const sendKey = useSendKey();
  const [caret, setCaret] = useState(0);
  const box = useRef<HTMLTextAreaElement>(null);
  const attached = useAttachments();
  // The draft: what is typed and attached is kept by Caduceus for this session, so it survives a reload and follows the owner to another device.
  const draft = useDraft({
    profile: settings.profile,
    session,
    text,
    attachments: attached.attachments,
    adopt: (made) => {
      setText(made.text);
      setCaret(made.text.length);
      attached.set(made.attachments);
    },
  });
  /** The message and its attachments are on their way to Hermes. */
  const [sending, setSending] = useState(false);
  const [dragging, setDragging] = useState(false);
  const empty = text.trim() === '' && attached.attachments.length === 0;
  /** The box holds just the words Repeat took to the schedule builder: they stay by design, so that the box says so and offers to clear them. */
  const leftover = repeatLeftover(session, text);
  useEffect(() => {
    if (text.trim() !== '' && !repeatLeftover(session, text)) forgetRepeat();
  }, [session, text]);
  /** Where the caret goes once a menu choice has put its text in the box (the box shows the new text first). */
  const nextCaret = useRef<number>(undefined);
  useLayoutEffect(() => {
    if (nextCaret.current === undefined) return;
    box.current?.setSelectionRange(nextCaret.current, nextCaret.current);
    nextCaret.current = undefined;
  }, [text]);
  const edit = ({ text: next, caret: at }: { text: string; caret: number }) => {
    nextCaret.current = at;
    setText(next);
    setCaret(at);
    box.current?.focus({ preventScroll: true });
  };
  /** What the saved-prompts library reads of the box and how it puts a prompt in: at the caret, replacing what is selected. */
  const promptsAccess: PromptsAccess = {
    current: () => {
      const start = box.current?.selectionStart ?? 0;
      const end = box.current?.selectionEnd ?? 0;
      return { text, selected: text.slice(start, end) };
    },
    insert: (words) => edit(insertAtCaret(text, { start: box.current?.selectionStart ?? text.length, end: box.current?.selectionEnd ?? text.length }, words)),
  };
  const menu = useComposerMenu({ chat, profile: settings.profile, text, caret, workspace: state.cwd ?? settings.defaultCwd, onEdit: edit });
  // Reply with selection: the quote goes after what is in the box, and the caret after it.
  const lastReply = useRef<QuoteRequest>(undefined);
  useEffect(() => {
    if (!reply || lastReply.current === reply) return;
    lastReply.current = reply;
    const next = replyWithSelection(text, reply.text);
    edit({ text: next, caret: next.length });
    // The request is the trigger; the text it is added to is read as it stands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reply]);
  // Words handed back by an undo or a fork (the message that was taken out, to edit): they go after what is in the box, and the caret after them.
  const lastPrefill = useRef<QuoteRequest>(undefined);
  useEffect(() => {
    if (!prefill || lastPrefill.current === prefill) return;
    lastPrefill.current = prefill;
    const next = text.trim() === '' ? prefill.text : `${text.trimEnd()}\n${prefill.text}`;
    edit({ text: next, caret: next.length });
    // The request is the trigger; the text it is added to is read as it stands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill]);
  /** A cancelled queued message comes back: after what is already in the box. */
  const toComposer = (back: string) => {
    setText((current) => (current.trim() === '' ? back : `${current.trimEnd()}\n${back}`));
    box.current?.focus({ preventScroll: true });
  };
  /** Starts a run command; false when it did not (its words stay in the box so that nothing typed is lost). */
  const runCommand = (command: RunCommand): boolean => {
    if (!chat) return false;
    switch (command.kind) {
      case 'missing':
        toast(`Write something after /${command.command}`, { tone: 'info' });
        return false;
      case 'gate':
        toast('A goal gate runs a command after every turn, so it is only set from Hermes’s own terminal', { tone: 'warning' });
        return false;
      case 'btw':
        void chat.btw(command.text);
        return true;
      case 'background':
        void chat.background(command.text);
        return true;
      case 'goal':
        void (command.action === 'set' ? chat.setGoal(command.text) : command.action === 'clear' ? chat.clearGoal() : chat.pauseGoal(command.action === 'pause')).catch(refused('Hermes did not take that goal command'));
        return true;
    }
  };
  const go = (mode: 'steer' | 'queue') => {
    const prompt = text.trim();
    const files = attached.attachments;
    if (!chat || sending || (!prompt && files.length === 0)) return;
    const plan = planDraft({ intent, text, attachments: files.length });
    if (plan.kind === 'refuse') {
      toast(plan.reason === 'attachments' ? 'Attachments stay with Ask' : 'Commands stay with Ask', { tone: 'warning', detail: plan.message });
      return;
    }
    if (plan.kind === 'delegate') {
      // Hermes's own background run (what /background starts): it tells the owner when it needs them or finishes, and shows under Work.
      void chat.background(plan.text);
      toast(`${settings.profile} is on it in the background`, { tone: 'info', detail: 'You are told when it needs you or finishes. It shows under Work.', action: { label: 'See in Work', onClick: () => void navigate('/work') } });
      setText('');
      setIntent(intentAfter(intent, plan));
      return;
    }
    if (plan.kind === 'repeat') {
      // The schedule builder opens with the message and the agent in it; nothing is created until the owner confirms the schedule there. The words stay in the box, and the box says so when they are still there on the way back.
      offerSchedule({ text: plan.text, profile: settings.profile });
      rememberRepeat(session, plan.text);
      setIntent(intentAfter(intent, plan));
      // An offer no builder takes would fill the next new-schedule form with these words (it also goes stale on its own): it goes when the page cannot open the builder.
      void navigate('/work/schedules/new').catch(clearSchedule);
      return;
    }
    // Attachments go with a message that starts a turn: Hermes queues them for the next prompt it runs, which a steer or a queued message is not.
    if (files.length > 0 && (state.running || (prompt !== '' && (runCommandOf(prompt) || looksLikeSlashCommand(prompt))))) {
      toast(state.running ? 'Attachments go with a message when Hermes is not answering' : 'Commands run without attachments', { tone: 'warning', detail: state.running ? 'Wait for the reply to finish, or remove the attachments to steer or queue.' : 'Send the attachments in a message of their own, or remove them.' });
      return;
    }
    const command = runCommandOf(prompt);
    if (command) {
      if (runCommand(command)) setText('');
      return;
    }
    if (looksLikeSlashCommand(prompt)) {
      // Hermes's other commands: what it answers is in the transcript. A command that did not run leaves its words in the box, so that nothing typed is lost.
      setText('');
      void chat.runSlash(prompt).then((outcome) => {
        if (outcome.kind === 'prefill') setText(outcome.text);
        else if (outcome.kind === 'failed') setText((current) => (current === '' ? prompt : current));
      });
      return;
    }
    setText('');
    if (files.length > 0) {
      setSending(true);
      void chat.send(prompt, { attachments: files, onProgress: attached.step }).then((sent) => {
        setSending(false);
        // What Hermes refused stays marked on its chip, with the words; the rest can go again.
        if (sent) attached.clear();
        else {
          attached.keepFailedSteps();
          setText((current) => (current === '' ? prompt : current));
        }
      });
    } else if (!state.running) void chat.send(prompt);
    else if (mode === 'queue') chat.enqueue(prompt);
    // A steer Hermes refuses leaves its words with the owner.
    else void chat.steer(prompt).then((sent) => !sent && setText((current) => (current === '' ? prompt : current)));
  };
  /** Adds files the owner picked, pasted or dropped. */
  const attach = (picked: Candidate[], extra: Problem[] = []) => void attached.add(picked, extra);
  /** The text of a large paste goes back into the message at the caret, and its file goes. */
  const putBack = async (id: string) => {
    const caretAt = box.current?.selectionStart ?? text.length;
    const kept = await keepInline(text, caretAt, attached.attachments, id);
    attached.set(kept.attachments);
    edit({ text: kept.text, caret: kept.caret });
  };
  const putBackLatest = useRef(putBack);
  putBackLatest.current = putBack;
  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...event.clipboardData.files];
    if (files.length > 0) {
      event.preventDefault();
      attach(files.map((file) => ({ name: file.name, body: file })));
      return;
    }
    const candidate = collapsePaste(event.clipboardData.getData('text/plain'), attached.attachments);
    if (!candidate) return;
    event.preventDefault();
    void attached.add([candidate]).then((list) => {
      const made = list.find((entry) => entry.pasted && entry.name === candidate.name);
      if (made) toast(`That paste was long, so it is attached as ${made.name}`, { tone: 'info', undo: () => void putBackLatest.current(made.id) });
    });
  };
  const droppable = (event: DragEvent) => event.dataTransfer.types.includes('Files');
  const onDrop = (event: DragEvent) => {
    if (!droppable(event)) return;
    event.preventDefault();
    setDragging(false);
    // Read now: the browser empties the drop once the handler returns.
    const picked: Candidate[] = [];
    const folders: Problem[] = [];
    for (const item of event.dataTransfer.items) {
      if (item.kind !== 'file') continue;
      const entry = item.webkitGetAsEntry?.();
      const file = item.getAsFile();
      if (entry?.isDirectory) folders.push({ name: entry.name, reason: 'A folder cannot be attached. Zip it, or point Hermes at it with @.' });
      else if (file) picked.push({ name: file.name, body: file });
    }
    attach(picked, folders);
  };
  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    go('steer');
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const sends = sendsMessage(event.nativeEvent, sendKey);
    // ⌘/Ctrl+Enter sends even with a menu open; a plain Enter that sends is first the menu's, which uses it to choose.
    if (sends && (event.metaKey || event.ctrlKey)) submit(event);
    else if (!menu.onKeyDown(event) && sends) submit(event);
  };
  useEffect(() => {
    if (!state.running) box.current?.focus({ preventScroll: true });
  }, [state.running]);
  // Voice (M7 #07): dictation fills the box for review, a recording becomes an attachment, and hands-free mode talks with the chat.
  const voicePrefs = useVoicePrefs();
  const [press, setPress] = useState<PressState>(initialPress);
  const hands = useHandsFree();
  /** Dictation that was asked to send on release: it goes once the words are in the box. */
  const sendDictation = useRef(false);
  const voice = useVoiceInput({
    prefs: voicePrefs,
    profile: settings.profile,
    onText: (spoken, send) => {
      edit(dictate(text, { start: box.current?.selectionStart ?? text.length, end: box.current?.selectionEnd ?? text.length }, spoken));
      sendDictation.current = send && !state.running;
    },
    onAudio: (audio, name) => attach([{ name, body: audio }]),
  });
  useEffect(() => {
    if (!sendDictation.current) return;
    sendDictation.current = false;
    go('steer');
    // Only a change of the words is a reason to look: `go` reads what is in the box now.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);
  // The session outlives this screen (the first message of a new chat draws it again), so it is given the chat to drive, and told when the screen goes.
  const chatLink = useMemo(() => (chat ? { send: (words: string) => chat.send(words), get state() { return chat.state; }, subscribe: chat.subscribe } : undefined), [chat]);
  useEffect(() => {
    handsFree.attach(chatLink, settings.profile, handsFreeEnded);
    return () => handsFree.detach();
  }, [chatLink, settings.profile]);

  return (
    <>
      <RunStatus chat={chat} state={state} toComposer={toComposer} />
      <ReadAloudBar />
      <form ref={formRef} className="chat__composer composer" data-dragging={dragging ? '' : undefined} onSubmit={submit} onDragOver={(event) => { if (droppable(event)) { event.preventDefault(); setDragging(true); } }} onDragLeave={(event) => !event.currentTarget.contains(event.relatedTarget as Node | null) && setDragging(false)} onDrop={onDrop}>
        {/* Inside the box, so that it travels with the sticky composer and never sits behind it. */}
        <ComposerMenuView menu={menu} />
        <ComposerBanner settings={settings} />
        {hands.active && <HandsFreePanel />}
        <VoiceStrip input={voice} press={press} />
        <DraftNotes view={draft.view} sync={draft.sync} />
        <WaitingDraftHint here={{ profile: settings.profile, session }} empty={empty} />
        <AttachmentNotes lines={attached.left} onDismiss={attached.dismissLeft} />
        <AttachmentChips attachments={attached.attachments} steps={attached.steps} locked={sending} onRemove={attached.remove} onKeepInline={(id) => void putBack(id)} />
        {dragging && (
          <p className="composer__drop" aria-hidden="true">
            Drop to attach (up to {MAX_ATTACHMENTS})
          </p>
        )}
        {leftover && (
          <div className="draft-note banner" data-tone="info" role="status" data-draft-note="repeat">
            <Icon name="info" />
            <div className="banner__content">
              <p>These words are still here from Repeat. Send them, change them or clear them. Typing more joins them.</p>
              <div className="draft-note__actions">
                <button type="button" className="btn btn--secondary btn--sm" onClick={() => { setText(''); forgetRepeat(); box.current?.focus({ preventScroll: true }); }}>
                  Clear the box
                </button>
              </div>
            </div>
          </div>
        )}
        <IntentChip intent={intent} onClear={() => setIntent('ask')} />
        <label className="sr-only" htmlFor="chat-message">
          Message to Hermes
        </label>
        <textarea id="chat-message" ref={box} rows={2} value={text} placeholder={state.running ? 'Steer Hermes, or queue a message for after this reply' : `Message ${settings.profile}`} enterKeyHint="enter" onChange={(event) => { setText(event.target.value); setCaret(event.target.selectionStart); }} onSelect={(event) => setCaret(event.currentTarget.selectionStart)} onKeyDown={onKeyDown} onPaste={onPaste} />
        <ComposerBar
          chat={chat}
          state={state}
          settings={settings}
          prompts={promptsAccess}
          intent={intent}
          onIntent={setIntent}
          empty={empty}
          sending={sending}
          voice={voice}
          voicePrefs={voicePrefs}
          handsActive={hands.active}
          onPress={setPress}
          onFiles={(files) => attach(files.map((file) => ({ name: file.name, body: file })))}
          onRecord={() => voice.begin('message')}
          onWorkspace={() => edit({ text: `${text}${text === '' || /\s$/.test(text) ? '' : ' '}@`, caret: text.length + (text === '' || /\s$/.test(text) ? 0 : 1) + 1 })}
          onSteer={() => go('steer')}
          onQueue={() => go('queue')}
          onStop={() => void chat?.stop().catch(refused('Hermes did not stop the turn'))}
        />
      </form>
    </>
  );
}

/** The conversation width (px) from which the outline sits beside the transcript: a transcript column (36rem) and the outline (12rem) with the gap. */
const OUTLINE_COLUMN_MIN_PX = 784;
/** Talk's Details panel on a large screen (21rem) and the gap beside it, which the outline's room does not include. */
const DETAILS_COLUMN_PX = 352;

/** The id of the message a link names (`?message=`), if it names one. */
function useMessageParam(): number | undefined {
  const { message } = useSearch({ strict: false }) as { message?: unknown };
  const id = typeof message === 'number' ? message : typeof message === 'string' ? Number(message) : NaN;
  return Number.isInteger(id) && id > 0 ? id : undefined;
}

/** The words a search hit was found by (`?find=`): the chat opens at the first message that holds them, with the transcript search on them. */
function useFindParam(): string | undefined {
  const { find } = useSearch({ strict: false }) as { find?: unknown };
  return typeof find === 'string' && find.trim() !== '' ? find : undefined;
}

/**
 * Where a search hit is in its session: read from Hermes (the first message that holds the words, and the prompt whose page has it) before the chat opens.
 * `pending` until Hermes has answered; a session with no such message (the hit was on its id) has no spot, and opens at the newest messages.
 */
function useHitSpot(profile: string, storedId: string | undefined, find: string | undefined): { pending: boolean; spot: HitSpot | undefined } {
  const key = storedId !== undefined && find !== undefined ? `${storedId}\n${find}` : undefined;
  const [answer, setAnswer] = useState<{ key: string; spot: HitSpot | undefined }>();
  useEffect(() => {
    if (key === undefined || storedId === undefined || find === undefined) return;
    let current = true;
    locateHit(readHermes, { sessionId: storedId, profile, query: find }).then(
      (spot) => current && setAnswer({ key, spot }),
      () => current && setAnswer({ key, spot: undefined }),
    );
    return () => {
      current = false;
    };
  }, [key, storedId, profile, find]);
  return { pending: key !== undefined && answer?.key !== key, spot: key !== undefined && answer?.key === key ? answer.spot : undefined };
}

/** What the transcript draws of a chat: its messages, less the cards the activity mode hides. */
const visibleMessages = (state: ChatState, mode: ActivityMode): ChatMessage[] =>
  transcriptOf(state).filter((message) => !message.activity || shownActivity(message.activity, mode).some((item) => item.kind !== 'reasoning' || item.text !== ''));

/** Terminal mode (M1 #19) is a screen of its own, with xterm: it is loaded when a chat is first opened in it. */
const TerminalMode = lazy(() => import('../terminal/TerminalMode.tsx').then((m) => ({ default: m.TerminalMode })));

/** One conversation: a stored session (`/chat/:id`), or a new chat that has no session until its first message. */
function Conversation({ profile, storedId, session }: { profile: string; storedId: string | undefined; session: SessionAccessState }) {
  const navigate = useAppNavigate();
  const around = useMessageParam();
  const find = useFindParam();
  // A link to a search hit has the words, not the message: where they are comes from Hermes, and the chat opens there.
  const hit = useHitSpot(profile, storedId, around === undefined ? find : undefined);
  // A session another process owns (or a Kanban worker) is read, never resumed: Hermes's answer for it (`session`) is read before the chat opens.
  const sessionReadOnly = session.access.mode === 'read-only';
  // Opening a finished run's chat is the review Today's Ready list waits for.
  useReviewOpened(storedId);
  const lineage = useLineage(profile, storedId);
  const size = useSizeClass();
  const large = size === 'large';
  const panelOpen = useDetailsOpen();
  const layout = useDetailsLayout();
  const { mode, chosen } = useActivityMode();
  const assistantName = useAssistantName(profile);
  const [chat, setChat] = useState<ChatEngine>();
  useEffect(() => {
    if (hit.pending || session.pending) return;
    const made = createChat(gatewayConnection(), {
      profile,
      storedId,
      ...(sessionReadOnly ? { readOnly: true } : {}),
      ...(hit.spot ? { around: hit.spot.prompt, focus: hit.spot.message } : around === undefined ? {} : { around }),
      // A mode the owner has chosen on this device goes to Hermes when the chat starts; one never chosen leaves Hermes's own setting alone.
      ...(chosen ? { activityMode: mode } : {}),
      stepUp: askStepUp,
      notify: (notice) => toast(notice.message, { tone: notice.tone, ...(notice.detail === undefined ? {} : { detail: notice.detail }) }),
    });
    setChat(made);
    return () => made.dispose();
    // A link's message is read when the chat opens; moving about inside the chat does not change the address.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, storedId, hit.pending, hit.spot, session.pending, sessionReadOnly]);
  const state = useStore(chat, NO_CHAT);
  const fastOn = useStore(fastMode, fastMode.state).on;
  // The chime (Settings › Chat) is for a reply that has just finished.
  const chime = useChatBehaviour().device.completionSound;
  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !state.running && chime) playCompletionSound();
    wasRunning.current = state.running;
  }, [state.running, chime]);
  const settings = useComposerSettings(chat, state, profile);
  // A new chat that Learn-a-skill opened starts with Hermes's /learn. Each chat engine starts it once, however often the effect runs.
  const learning = useRef<ChatEngine>(undefined);
  useEffect(() => {
    if (!chat || storedId !== undefined || learning.current === chat) return;
    learning.current = chat;
    const topic = takeLearn(profile);
    if (topic !== undefined) void chat.learn(topic).catch(refused('Hermes did not start /learn'));
  }, [chat, storedId, profile]);
  const composer = useRef<HTMLFormElement>(null);
  const readOnlyBar = useRef<HTMLElement>(null);
  const [jump, setJump] = useState<JumpRequest>();
  const [quote, setQuote] = useState<QuoteRequest>();
  // Words handed back to the message box: the message an undo took out, or the one a fork was made from.
  const [prefill, setPrefill] = useState<QuoteRequest>();
  const giveBack = useCallback((text: string) => setPrefill((last) => ({ text, nonce: (last?.nonce ?? 0) + 1 })), []);
  useEffect(() => {
    const waiting = takePrefill(storedId);
    if (waiting !== undefined) giveBack(waiting);
  }, [storedId, giveBack]);
  // A link `/chat/new?prompt=` puts words in the box (never sent), and a worktree session starts in its worktree.
  useNewChatStart({ chat, profile, storedId, onPrompt: giveBack });
  /** The message being edited, with the words as the owner last left them (a declined confirmation reopens the sheet as it was). */
  const [editing, setEditing] = useState<{ message: ChatMessage; text: string }>();
  const [renaming, setRenaming] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [sharing, setSharing] = useState(false);
  const sessionActions = useSessionActions(profile);
  // A refine chip sends its follow-up at once (queued behind a reply that is still being written); Reply with selection only fills the message box.
  const refine = (chip: Refinement, selection: string) => {
    if (!chat) return;
    const prompt = refinePrompt(chip, selection);
    if (state.running) chat.enqueue(prompt);
    else void chat.send(prompt);
  };
  // The outline gets a column of its own when the conversation is wide enough for it beside the transcript, else a fold above it.
  const section = useRef<HTMLElement>(null);
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const element = section.current;
    if (!element) return;
    const watch = new ResizeObserver(([entry]) => setWide((entry?.contentRect.width ?? 0) - (layout === 'column' && panelOpen ? DETAILS_COLUMN_PX : 0) >= OUTLINE_COLUMN_MIN_PX));
    watch.observe(element);
    return () => watch.disconnect();
  }, [layout, panelOpen]);

  // A new chat that has sent its first message is a stored session now: its address says which. Not before the message is on its way: attachments need the session
  // first, and a page that moved on then would lose what the owner is still composing if Hermes refused one of them.
  const started = state.turn !== undefined || state.messages.length > 0;
  useEffect(() => {
    if (storedId === undefined && state.storedId !== undefined && started) void navigate(`/chat/${state.storedId}`, { replace: true });
  }, [storedId, state.storedId, started, navigate]);

  // "Make this a task" needs a stored session to point at, and it starts a change in Hermes, so read-only mode has none of it.
  const readOnly = useReadOnly();
  const canMakeTask = state.storedId !== undefined && !readOnly;
  /** A turn is running or arriving: Hermes refuses to cut or undo its history then. A turn that failed is over. */
  const busy = state.running || (state.turn !== undefined && state.turn.status !== 'failed');
  const lastHeld = state.messages.findLast((message) => message.id !== undefined)?.id;
  const messages = visibleMessages(state, mode);
  const items = useMemo<TranscriptItem[]>(
    () =>
      messages.map((message, index) => ({
        key: message.id !== undefined ? `r${message.id}` : (message.key ?? `turn-${message.role}-${index}`),
        message,
        streaming: state.turn !== undefined && !state.hasNewer && index === messages.length - 1 && message.role === 'assistant' && !message.activity,
        context: { last: message.id !== undefined && message.id === lastHeld && !state.hasNewer, busy, link: message.id !== undefined && state.storedId !== undefined, task: canMakeTask, ...(state.readOnly ? { readOnly: true as const } : {}) },
      })),
    // `messages` is rebuilt at every render; what it holds is `state.messages`, `state.turn` and the children.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.messages, state.turn, state.hasNewer, state.subagents, mode, busy, lastHeld, canMakeTask, state.storedId, state.readOnly],
  );
  const outline = useRef(createOutlineBuilder());
  const entries = useMemo(() => (large ? outline.current(items.map(({ key, message }) => ({ key, role: message.role, text: message.role === 'user' ? splitAttachments(message.text).body : message.text }))) : []), [large, items]);
  const jumpTo = (entry: OutlineEntry) => setJump({ key: entry.key, ...(entry.anchor === undefined ? {} : { anchor: entry.anchor }), nonce: (jump?.nonce ?? 0) + 1 });
  // The transcript's tools: role filters, search in the chat (opened by a search hit's words), expand all / collapse all.
  const tools = useTranscriptTools({
    items,
    chat,
    partial: state.hasOlder || state.hasNewer,
    initialQuery: find,
    focusKey: state.focusId === undefined ? undefined : `r${state.focusId}`,
    onJump: (key) => setJump((was) => ({ key, nonce: (was?.nonce ?? 0) + 1 })),
  });
  const linkTo = (id: number) => {
    const query = new URLSearchParams({ ...(profile === 'default' ? {} : { profile }), message: String(id) });
    return `${location.origin}/chat/${state.storedId}?${query}`;
  };

  // The handler for every message is one function for the life of the conversation (the transcript draws a message again when it changes), so it reads the chat as of the click.
  const latest = useRef({ chat, state, storedId: state.storedId, title: state.title, linkTo, navigate, profile });
  latest.current = { chat, state, storedId: state.storedId, title: state.title, linkTo, navigate, profile };
  // Auto-read (Settings › Voice): a reply that finishes in front of the owner is read aloud. Browsers may refuse audio the owner did not ask for in a tap; the bar says so.
  useFinishedReply(state, (reply) => voicePrefsNow().autoRead && void readReply(`auto:${reply.id ?? Date.now()}`, reply.text, profile));
  const makeTaskFromMessage = useCallback(({ message }: TranscriptItem) => {
    const { storedId: sessionId, title, linkTo: link, navigate: go } = latest.current;
    if (sessionId === undefined) return;
    offerBrief(prefillFromMessage({ text: message.text, role: message.role, session: { id: sessionId, title: title ?? null }, ...(message.id === undefined ? {} : { messageLink: link(message.id) }) }));
    void go('/work/tasks/new');
  }, []);
  // The whole chat is what the engine holds now: older messages that are not loaded are not in it.
  const makeTaskFromChat = () => {
    if (state.storedId === undefined) return;
    offerBrief(prefillFromSession({ messages: state.messages, session: { id: state.storedId, title: state.title ?? null } }));
    void navigate('/work/tasks/new');
  };

  // ── Message actions (M1 #12) ──
  const copied = useCallback(async (text: string, said = 'Copied') => {
    const done = await copyText(text);
    toast(done ? said : 'Could not copy', { tone: done ? 'success' : 'danger', ...(done ? {} : { detail: 'Your browser did not let the page use the clipboard. Select the text and copy it by hand.' }) });
  }, []);
  const [copying, setCopying] = useState(false);
  /** The whole chat as text, less what the role filters hide: what Hermes holds beyond the loaded messages is read first (the clipboard is handed the text still being made). */
  const copyTranscript = async (format: CopyFormat) => {
    if (!chat || copying) return;
    setCopying(true);
    const names = { user: 'You', assistant: assistantName ?? 'Hermes' };
    const made = (async () => {
      if (chat.state.hasOlder || chat.state.hasNewer) await chat.loadAll();
      const entries = filterItems(visibleMessages(chat.state, mode).map((message, index) => ({ key: String(index), message })), tools.roles);
      return { text: transcriptText(entries, tools.roles, format, names), count: entries.length };
    })();
    try {
      const done = await copyText(made.then(({ text }) => text));
      const { count } = await made;
      toast(done ? `Copied the chat as ${format === 'markdown' ? 'Markdown' : 'plain text'}` : 'Could not copy', {
        tone: done ? 'success' : 'danger',
        detail: done ? `${count} message${count === 1 ? '' : 's'} and card run${count === 1 ? '' : 's'}${ROLES.every((role) => tools.roles[role]) ? '' : ', without what the filters hide'}.` : 'Your browser did not let the page use the clipboard.',
      });
    } catch (error) {
      refused('Hermes did not give the whole chat')(error);
    } finally {
      setCopying(false);
    }
  };
  const [branching, setBranching] = useState(false);
  /** Continues the session in a new one (Hermes's `session.branch`): the original is untouched, and the new one is this app's to continue. */
  const branch = async () => {
    if (!chat || branching) return;
    setBranching(true);
    try {
      const { storedId: id } = await chat.branch();
      toast('Branched into a new session', { tone: 'success', detail: 'It has every message of this one. The original is as it was.' });
      void navigate(`/chat/${id}`);
    } catch (error) {
      refused('Hermes did not branch this session')(error);
    } finally {
      setBranching(false);
    }
  };
  // The handoff note is Hermes's one-shot model's, written on request; it is kept only in this state.
  const [handoff, setHandoff] = useState<{ note: string | undefined; truncated: boolean; working: boolean }>();
  const summarise = async () => {
    if (!chat || handoff?.working) return;
    const request = summaryRequest(visibleMessages(chat.state, mode), { user: 'You', assistant: assistantName ?? 'Hermes' });
    if (request.input === '') {
      toast('There is nothing to summarise yet', { tone: 'info' });
      return;
    }
    const confirmed = await confirmTier({
      tier: 'T1',
      moduleId: 'chat',
      action: 'chat.handoff-summary',
      label: 'Write a handoff summary?',
      text: 'Hermes’s one-shot model reads this chat and writes a short note for whoever picks it up. That is a model call, which costs tokens on your provider. The note is shown here and kept nowhere.',
      profile,
      confirmLabel: 'Write the summary',
    });
    if (!confirmed) return;
    setHandoff({ note: undefined, truncated: request.truncated, working: true });
    try {
      const note = await generateSummary(gatewayConnection().client, { profile, instructions: request.instructions, input: request.input });
      setHandoff({ note: note === '' ? 'Hermes wrote nothing.' : note, truncated: request.truncated, working: false });
    } catch (error) {
      setHandoff(undefined);
      refused('Hermes did not write the summary')(error);
    }
  };
  const fork = useCallback(async (from?: number) => {
    const { chat: engine, navigate: go } = latest.current;
    if (!engine) return;
    try {
      const { storedId: id, prefill: words, notCut } = await engine.fork(from);
      if (words !== undefined) offerPrefill(id, splitAttachments(words).body);
      if (notCut === undefined) toast('Forked into a new chat', { tone: 'success', detail: from === undefined ? 'It has every message of this chat.' : 'It starts at that message; this chat is as it was.' });
      else toast('Forked, but not at that message', { tone: 'warning', detail: notCut, timeout: 12_000 });
      void go(`/chat/${id}`);
    } catch (error) {
      refused('Could not fork this chat')(error);
    }
  }, []);
  const undo = useCallback(async () => {
    const { chat: engine } = latest.current;
    if (!engine) return;
    try {
      const { removed, message } = await engine.undo();
      if (removed === 0) {
        toast('There is nothing to undo', { tone: 'info' });
        return;
      }
      const shown = message === undefined ? '' : splitAttachments(message).body.replace(/\s+/g, ' ').trim();
      toast('Undid the last exchange', {
        tone: 'info',
        detail: `Hermes took ${removed} message${removed === 1 ? '' : 's'} out of this chat${shown === '' ? '' : `, starting with “${shown.length > 60 ? `${shown.slice(0, 59)}…` : shown}”`}.`,
        ...(message === undefined ? {} : { action: { label: 'Put the message back', onClick: () => giveBack(splitAttachments(message).body) } }),
        timeout: 10_000,
      });
    } catch (error) {
      refused('Hermes did not undo')(error);
    }
  }, [giveBack]);
  const regenerate = useCallback(async () => {
    const { chat: engine } = latest.current;
    if (!engine) return;
    const confirmed = await confirmTier({
      tier: 'T1',
      moduleId: 'chat',
      action: 'chat.regenerate',
      label: 'Regenerate this reply?',
      text: 'Hermes removes the last reply and writes another one from your message. It cannot bring the old reply back.',
      confirmLabel: 'Regenerate',
    });
    if (confirmed) await engine.regenerate();
  }, []);
  const resend = useCallback(async (message: ChatMessage, text: string) => {
    const { chat: engine, state: now } = latest.current;
    if (!engine || message.id === undefined) return;
    setEditing(undefined);
    await closeAllLayers();
    const later = removedByEdit(now.messages, message.id);
    const after = later.messages - 1;
    const confirmed = await confirmTier({
      tier: 'T1',
      moduleId: 'chat',
      action: 'chat.edit-resend',
      label: 'Edit and resend this message?',
      text: after === 0 ? 'Hermes replaces this message with your edit and answers it.' : `Hermes replaces this message with your edit and removes the ${after} message${after === 1 ? '' : 's'} after it${later.replies > 0 ? `, ${later.replies} of them repl${later.replies === 1 ? 'y' : 'ies'} of its own` : ''}. It cannot bring them back.`,
      confirmLabel: 'Edit and resend',
    });
    if (confirmed) await engine.editAndResend(message.id, text);
    else setEditing({ message, text });
  }, []);
  /** One of a message's actions, from its toolbar, its ⋮ menu or a press and hold. */
  const act = useCallback(
    (id: MessageActionId, item: TranscriptItem) => {
      const { chat: engine, linkTo: link } = latest.current;
      const { message } = item;
      const body = message.role === 'user' ? splitAttachments(message.text).body : message.text;
      switch (id) {
        case 'copy-text':
          void copied(message.failed ? message.failed.error : plainText(body));
          break;
        case 'copy-markdown':
          void copied(body);
          break;
        case 'read-aloud':
          void readReply(String(message.id ?? item.key), message.text, latest.current.profile);
          break;
        case 'link':
          if (message.id !== undefined) void copied(link(message.id), 'Link copied');
          break;
        case 'task':
          makeTaskFromMessage(item);
          break;
        case 'edit':
          setEditing({ message, text: editableText(message.text) });
          break;
        case 'regenerate':
          void regenerate();
          break;
        case 'retry':
          void engine?.retry();
          break;
        case 'fork':
          void fork(message.id);
          break;
        case 'undo':
          void undo();
          break;
      }
    },
    [copied, fork, undo, regenerate, makeTaskFromMessage],
  );
  const titled = state.storedId === undefined ? undefined : ({ id: state.storedId, title: state.title ?? '', preview: '', source: CADUCEUS_SESSION_SOURCE, startedAt: 0, lastActive: 0, messageCount: state.messages.length, pinned: false, unread: false, failed: false, profile, archived: false, cwd: '', tokens: 0 } satisfies SessionItem);
  const titleChanged = () => void chat?.refreshTitle().catch(() => undefined);
  const interrupted = interruptionOf(state);

  // Details is closed until the header's button opens it: a column from 1280 px, a panel over the thread on a tablet (both remembered by the device) and a sheet on a phone.
  const [detailsSheet, setDetailsSheet] = useState(false);
  const detailsButton = useRef<HTMLButtonElement>(null);
  const findInput = useRef<HTMLInputElement>(null);
  const [sessionsSheet, setSessionsSheet] = useState(false);
  const [workView, setWorkView] = useState<WorkspaceView>();
  const member = useCrew().find((row) => row.profile === profile);
  const compact = size === 'compact';
  const chooseMode = (next: ActivityMode) => {
    chooseActivityMode(next);
    // A read-only session has no runtime to set it on: the mode only decides what is shown here.
    if (!state.readOnly) chat?.setActivityMode(next).catch((error: unknown) => toast('Hermes did not accept that activity mode', { tone: 'danger', detail: error instanceof Error ? error.message : String(error) }));
  };
  const openChild = (sessionId: string) => (
    <AppLink className="btn btn--secondary btn--sm" to={`/chat/${sessionId}`}>
      Open its activity
    </AppLink>
  );
  const goalAction = (title: string, run: () => Promise<void>) => run().catch(refused(title));
  const plan = (
    <ContextPanel
      todos={state.todos}
      subagents={state.subagents}
      usage={state.usage}
      goal={state.goal}
      onSetGoal={chat ? (text) => goalAction('Hermes did not take that goal', () => chat.setGoal(text)) : undefined}
      onClearGoal={chat ? () => goalAction('Hermes did not clear the goal', () => chat.clearGoal()) : undefined}
      onPauseGoal={chat ? (paused) => goalAction(paused ? 'Hermes did not pause the goal' : 'Hermes did not resume the goal', () => chat.pauseGoal(paused)) : undefined}
      openChild={openChild}
    />
  );
  const details = <TalkDetails profile={profile} member={member} state={state} chat={chat} plan={plan} view={workView} onView={setWorkView} />;
  const waiting = openWork(state.todos, state.subagents);
  const taskOffered = canMakeTask && state.messages.some((message) => message.text.trim() !== '');
  const sheeted = layout === 'sheet';
  const detailsOpen = sheeted ? detailsSheet : panelOpen;
  const pinLimit = useChatBehaviour().account.pinLimit;
  const flags = useSessionFlags(profile, state.storedId);
  const menuEntries = threadMenu({ readOnlySession: state.readOnly, taskOffered, busy, empty: state.messages.length === 0, terminal: storedId !== undefined && terminalModeOffered(size), pinned: flags.pinned, archived: flags.archived });
  /** What each line of the More menu does; the lines, their order and their reasons are `talk-header.ts`'s. */
  const runThreadAction = (id: ThreadActionId) => {
    if (!titled) return;
    const item = { ...titled, pinned: flags.pinned, archived: flags.archived };
    const actions: Record<ThreadActionId, () => void> = {
      rename: () => setRenaming(true),
      pin: () => void setPinnedWithinLimit({ actions: sessionActions, item, pin: !flags.pinned, limit: pinLimit }).then((outcome) => report(outcome, flags.refresh)),
      task: makeTaskFromChat,
      archive: () => void sessionActions.setArchived(item, !flags.archived).then((outcome) => report(outcome, flags.refresh)),
      'regenerate-title': () => void sessionActions.regenerateTitle(titled).then((outcome) => report(outcome, titleChanged)),
      fork: () => void fork(),
      undo: () => void undo(),
      'handoff-summary': () => void summarise(),
      branch: () => void branch(),
      export: () => setExporting(true),
      share: () => setSharing(true),
      terminal: () => void navigate(`/chat/${encodeURIComponent(storedId ?? item.id)}?mode=terminal`),
    };
    actions[id]();
  };

  return (
    <AgentContext value={profile}>
    <section ref={section} className="chat__conversation" aria-label="Conversation">
      <TalkHeader
        profile={profile}
        state={chatState({ requests: state.requests.length, running: state.running || (state.turn !== undefined && state.turn.status !== 'failed'), failed: state.turn?.status === 'failed' })}
        subtitle={
          <>
            {state.title ?? (storedId === undefined ? 'New chat' : 'Chat')}
            {state.forkedFrom && (
              <>
                {' · Forked from '}
                <AppLink className="chat__forked" to={`/chat/${state.forkedFrom.id}`}>
                  {state.forkedFrom.title ?? 'the original chat'}
                </AppLink>
              </>
            )}
            {assistantName ? ` · with ${assistantName}` : ''}
          </>
        }
        compact={compact}
        detailsOpen={detailsOpen}
        detailsControls={sheeted ? DETAILS_SHEET_ID : DETAILS_ID}
        detailsButton={detailsButton}
        waiting={waiting}
        onDetails={() => (sheeted ? setDetailsSheet(true) : setDetailsOpen(!panelOpen))}
        onSessions={() => setSessionsSheet(true)}
        view={
          fastOn ? undefined : (
            <TranscriptView
              tools={tools}
              mode={mode}
              onMode={chooseMode}
              assistantName={assistantName ?? 'Hermes'}
              hasMessages={items.length > 0}
              copying={copying || !ROLES.some((role) => tools.roles[role])}
              onCopy={(format) => void copyTranscript(format)}
              findInput={findInput}
            />
          )
        }
        menu={titled ? { entries: menuEntries, onRun: runThreadAction, onOpen: flags.refresh } : undefined}
      />
      {((session.source !== undefined && session.source !== CADUCEUS_SESSION_SOURCE) || (lineage && lineage.segments.length > 1)) && (
        <div className="chat__origin">
          {session.source !== undefined && session.source !== CADUCEUS_SESSION_SOURCE && <SourceTag source={session.source} />}
          <SegmentsBar lineage={lineage} />
        </div>
      )}
      <WorktreeBar cwd={state.cwd} />
      {exporting && titled && <ExportSheet item={titled} profile={profile} onClose={() => setExporting(false)} />}
      {sharing && titled && <ShareSheet item={titled} profile={profile} onClose={() => setSharing(false)} />}
      {renaming && titled && (
        <RenameSheet
          item={titled}
          onSave={(title) => {
            setRenaming(false);
            afterSheet(() => void sessionActions.rename(titled, title).then((outcome) => report(outcome, titleChanged)));
          }}
          onClose={() => setRenaming(false)}
        />
      )}
      {editing && (
        <EditSheet
          message={editing.message}
          initial={editing.text}
          later={removedByEdit(state.messages, editing.message.id ?? -1)}
          onSubmit={(text) => void resend(editing.message, text)}
          onClose={() => setEditing(undefined)}
        />
      )}
      {/* Below the large size class Details is a sheet, opened by the header's button. */}
      {detailsSheet && sheeted && (
        <Sheet title="Details" detents={['half', 'full']} onClose={() => setDetailsSheet(false)}>
          <div id={DETAILS_SHEET_ID}>{details}</div>
        </Sheet>
      )}
      {/* A phone has no room for the sessions list beside the conversation: it is a sheet, one tap from the header. */}
      {sessionsSheet && compact && (
        <Sheet title={`Sessions of ${profile}`} detents={['full']} className="talk-sessions" onClose={() => setSessionsSheet(false)}>
          <SessionsPane profile={profile} activeId={storedId} scope={TALK_SCOPE} />
        </Sheet>
      )}
      <FastLeaveGuard />
      <div className="chat__body" data-outline={large ? (wide ? 'side' : 'fold') : undefined} data-context={layout === 'column' && panelOpen ? '' : undefined}>
        <div className="chat__main">
          {state.yolo && (
            <p className="banner" data-tone="warning" role="status">
              <Icon name="alert" />
              <span className="banner__content">YOLO is on: Hermes runs every command in this chat without asking.</span>
            </p>
          )}
          {state.catchingUp && (
            <p className="banner" data-tone="info" role="status">
              <Icon name="refresh" />
              <span className="banner__content">Catching up…</span>
            </p>
          )}
          {fastOn ? (
            <FastPanel profile={profile} chat={chat} settings={settings} />
          ) : (
            <>
          <HandoffNote note={handoff?.note} truncated={handoff?.truncated ?? false} working={handoff?.working ?? false} onCopy={() => void copied(handoff?.note ?? '', 'Copied the summary')} onDismiss={() => setHandoff(undefined)} />
          {items.length > 0 && <FindBar find={tools.find} input={findInput} />}
          {large && !wide && <Outline layout="fold" entries={entries} onJump={jumpTo} />}
          <CardControlContext value={tools.cards}>
          <Transcript
            items={tools.shown}
            find={tools.view}
            composer={state.readOnly ? readOnlyBar : composer}
            hasOlder={state.hasOlder}
            hasNewer={state.hasNewer}
            loadingMore={state.loadingMore}
            onLoadOlder={() => void chat?.loadOlder()}
            onLoadNewer={() => void chat?.loadNewer()}
            onShowLatest={() => void chat?.showLatest()}
            activityMode={mode}
            openChild={openChild}
            focusKey={state.focusId === undefined ? undefined : `r${state.focusId}`}
            jump={jump}
            onAct={act}
            tail={
              <>
                {storedId === undefined && !started && <NewChatStart profile={profile} />}
                {state.turn?.status === 'waiting' && (
                  <p className="subtle" role="status">
                    Hermes is starting…
                  </p>
                )}
                {interrupted && chat && <InterruptedNotice why={interrupted} onContinue={() => void chat.continueTurn()} onRetry={() => void chat.retry()} />}
                <CommandNotes notes={state.notes} onDismiss={(id) => chat?.dismissNote(id)} />
              </>
            }
          />
          </CardControlContext>
          {state.error && (
            <p className="banner chat__error" data-tone="danger" role="alert">
              <Icon name="alert" />
              <span className="banner__content">{state.error}</span>
            </p>
          )}
          {state.readOnly && session.access.mode === 'read-only' ? (
            <>
              <div className="cx-cards">
                <DecideTray storedId={storedId} />
              </div>
              <ReadOnlyBar access={session.access} barRef={readOnlyBar} branching={branching} onBranch={() => void branch()} onCheck={session.access.reason === 'other-process' ? session.recheck : undefined} />
            </>
          ) : (
            <>
              <PendingRequests chat={chat} state={state}>
                <DecideTray storedId={storedId} composer={composer} />
              </PendingRequests>
              <Composer chat={chat} state={state} formRef={composer} settings={settings} reply={quote} prefill={prefill} session={storedId ?? NEW_CHAT} />
              <SelectionActions composer={composer} onReply={(text) => setQuote((last) => ({ text, nonce: (last?.nonce ?? 0) + 1 }))} onRefine={refine} />
            </>
          )}
          {!state.readOnly && <p className="subtle chat__note">
            {state.running ? (
              <>
                While Hermes answers: <Term id="steer">Steer</Term> redirects the reply, <Term id="queue">Queue</Term> sends your message when it is done, Stop interrupts. Start a line with /btw or /background to run it beside the reply, or /goal to set a <Term id="goal">goal</Term>.
              </>
            ) : (
              <>
                A reply is a <Term id="turn">turn</Term>: it keeps running in Hermes if you leave. Type / for <Term id="slash-command">commands</Term> and @ for files, or attach up to {MAX_ATTACHMENTS} <Term id="attachment">attachments</Term>.
              </>
            )}
          </p>}
            </>
          )}
        </div>
        {large && wide && <Outline layout="side" entries={entries} onJump={jumpTo} />}
        {!sheeted && panelOpen && (
          <DetailsPanel layout={layout} profile={profile} opener={detailsButton} onClose={() => setDetailsOpen(false)}>
            {details}
          </DetailsPanel>
        )}
      </div>
    </section>
    </AgentContext>
  );
}

/** Reads Hermes's answer for the session first: one it has in no profile is a not-found note, and one in another profile opens under that profile, before any chat is started. */
function ConversationGate({ profile, storedId }: { profile: string; storedId: string | undefined }) {
  const session = useSessionAccess(profile, storedId);
  if (storedId !== undefined && session.missing) return <SessionGone profile={profile} storedId={storedId} />;
  if (storedId !== undefined && session.pending) {
    return (
      <section className="chat__conversation chat__none" aria-label="Conversation">
        <Loading label="Opening this conversation…" lines={4} onRetry={session.recheck} />
      </section>
    );
  }
  return <Conversation profile={profile} storedId={storedId} session={session} />;
}

/** Talk: an agent's newest conversation, with its sessions listed beside it (a column; on a phone a sheet) and its Details. Without a session in the address it opens the latest one. */
export function Chat() {
  const { id } = useParams({ strict: false }) as { id?: string };
  useEffect(() => {
    void loadChatBehaviour();
  }, []);
  const isNew = useRouteInfo().pathname === '/chat/new';
  const { effective } = useProfileScope();
  const size = useSizeClass();
  const compact = size === 'compact';
  const { mode } = useSearch({ strict: false }) as { mode?: unknown };
  const profile = effective?.name;
  const conversation = isNew || id !== undefined;
  const storedId = isNew ? undefined : id;
  // Terminal mode (`?mode=terminal`) shows Hermes's TUI on a stored session: the terminal toggle is offered on a tablet or a computer, and Details' Take over opens it anywhere.
  const terminal = mode === 'terminal' && storedId !== undefined;

  if (!profile) {
    return (
      <div className="page-stack">
        <PageHeader title="Chat" />
        <p className="subtle">Loading…</p>
      </div>
    );
  }
  return (
    <>
      {!conversation && <PageHeader title="Chat" />}
      <div className="chat" data-conversation={conversation ? '' : undefined}>
      {!compact && <SessionsPane profile={profile} activeId={storedId} scope={TALK_SCOPE} />}
      {terminal ? (
        <Suspense fallback={<section className="chat__conversation" aria-label="Conversation in terminal mode"><p className="subtle" role="status">Opening the terminal…</p></section>}>
          <TerminalMode key={`${profile}/${storedId}`} profile={profile} storedId={storedId} />
        </Suspense>
      ) : conversation ? (
        <ConversationGate key={`${profile}/${storedId ?? 'new'}`} profile={profile} storedId={storedId} />
      ) : (
        <LatestSession profile={profile} />
      )}
      </div>
    </>
  );
}
