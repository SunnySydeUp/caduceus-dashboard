// Hands-free mode (M7 #07) as one session for the page: it opens the microphone, watches its level for the end of each utterance (`endpointer.ts`), has
// Hermes transcribe it, sends the words to the chat, speaks the reply through the page's one reader and listens again. The conversation itself is
// `hands-free.ts`; this does what it asks. It lives outside any one screen because the first message of a new chat moves the chat to its own address,
// and the screen is drawn again for it: whatever screen shows the chat attaches to the session, and one that goes without another taking its place
// within a moment ends it. It also ends on Stop, when something fails and when the page is hidden.
import { useSyncExternalStore } from 'react';
import { describeMicError } from './mic.ts';
import { createEndpointer } from './endpointer.ts';
import { handsFreeStart, handsFreeStep, type HandsFreeEffect, type HandsFreeEvent, type HandsFreeState } from './hands-free.ts';
import { unlockAudio } from './playback.ts';
import { readAloud } from './read-aloud-store.ts';
import { openMic, type Mic, type Recording } from './recorder.ts';
import { finishedReply, replyTo, type ReplyView } from './replies.ts';
import { speakable, speechParts } from './speakable.ts';
import { transcribe } from './voice-api.ts';

/** The part of the chat engine hands-free mode drives. */
export interface ChatLink {
  send(text: string): Promise<boolean>;
  readonly state: ReplyView;
  subscribe(listener: () => void): () => void;
}

export interface HandsFreeSnapshot {
  /** A conversation is running (or starting). */
  active: boolean;
  state: HandsFreeState;
  /** The microphone's level, 0 to 1, while it listens (for the meter). */
  level: number;
  /** What the owner said last, once transcribed. */
  heard: string;
}

const LEVEL_EVERY_MS = 100;
/** How long a screen may be gone before the session ends: the new chat's screen is drawn again at once. */
export const REATTACH_GRACE_MS = 1500;

const IDLE: HandsFreeSnapshot = { active: false, state: handsFreeStart, level: 0, heard: '' };

class HandsFreeSession {
  #snapshot = IDLE;
  readonly #listeners = new Set<() => void>();
  #machine = handsFreeStart;
  #link: ChatLink | undefined;
  #profile: string | undefined;
  #onEnd: ((reason: string | undefined) => void) | undefined;
  #mic: Mic | undefined;
  #recording: Recording | undefined;
  #meter: number | undefined;
  #awaiting: { text: string; seen: boolean; unwatch: () => void } | undefined;
  #goneTimer: number | undefined;
  #starting = 0;

  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => void this.#listeners.delete(listener);
  };
  snapshot = () => this.#snapshot;

  #publish(change: Partial<HandsFreeSnapshot>) {
    this.#snapshot = { ...this.#snapshot, ...change };
    this.#listeners.forEach((listener) => listener());
  }

  /** A screen that shows the chat takes over the link to it (and what to tell when the session ends). */
  attach(link: ChatLink | undefined, profile: string | undefined, onEnd: (reason: string | undefined) => void) {
    window.clearTimeout(this.#goneTimer);
    this.#link = link;
    this.#profile = profile;
    this.#onEnd = onEnd;
    // A reply that was awaited on the screen that has gone is awaited on this one, from the start: this chat has not been seen working yet.
    if (this.#awaiting) this.#watch(this.#awaiting.text, false, true);
  }

  /** The screen goes. If no other attaches soon, the conversation ends: nothing keeps listening once the chat is left. */
  detach() {
    window.clearTimeout(this.#goneTimer);
    this.#awaiting?.unwatch();
    this.#goneTimer = window.setTimeout(() => this.stop(undefined), REATTACH_GRACE_MS);
  }

  start() {
    if (this.#snapshot.active) return;
    const attempt = ++this.#starting;
    this.#machine = handsFreeStart;
    this.#publish({ active: true, state: handsFreeStart, level: 0, heard: '' });
    unlockAudio();
    document.addEventListener('visibilitychange', this.#hidden);
    openMic().then(
      (opened) => {
        if (attempt !== this.#starting || !this.#snapshot.active) return opened.close();
        this.#mic = opened;
        this.#send({ type: 'listening' });
        this.#listen();
      },
      (error: unknown) => this.#send({ type: 'failed', message: describeMicError(error, navigator.userAgent).message }),
    );
  }

  stop(reason?: string) {
    if (!this.#snapshot.active) return;
    this.#close(reason);
  }

  skip() {
    readAloud.stop();
  }

  #hidden = () => document.hidden && this.stop(undefined);

  #close(reason: string | undefined) {
    this.#starting++;
    window.clearInterval(this.#meter);
    this.#awaiting?.unwatch();
    this.#awaiting = undefined;
    this.#recording?.cancel();
    this.#recording = undefined;
    this.#mic?.close();
    this.#mic = undefined;
    readAloud.stop();
    document.removeEventListener('visibilitychange', this.#hidden);
    window.clearTimeout(this.#goneTimer);
    this.#machine = { ...this.#machine, phase: 'stopped' };
    this.#publish({ active: false, state: this.#machine, level: 0 });
    this.#onEnd?.(reason);
  }

  #send(event: HandsFreeEvent) {
    const step = handsFreeStep(this.#machine, event);
    this.#machine = step.state;
    this.#publish({ state: step.state });
    for (const effect of step.effects) void this.#run(effect);
  }

  #listen() {
    const open = this.#mic;
    if (!open || !this.#snapshot.active) return;
    window.clearInterval(this.#meter);
    this.#recording?.cancel();
    this.#recording = open.record();
    const endpointer = createEndpointer();
    this.#meter = window.setInterval(() => {
      const loud = open.level();
      this.#publish({ level: loud });
      const verdict = endpointer.push(loud, performance.now());
      if (verdict === 'ended') {
        window.clearInterval(this.#meter);
        this.#publish({ level: 0 });
        this.#send({ type: 'utterance' });
      } else if (verdict === 'nothing') {
        this.#send({ type: 'nothing' });
      }
    }, LEVEL_EVERY_MS);
  }

  /** Waits for the reply to `text` on the chat this session is attached to. `seen`: the turn has been seen working. `byWords`: a chat that is settled already may hold the reply (a screen took over). */
  #watch(text: string, seen: boolean, byWords = false) {
    const link = this.#link;
    this.#awaiting?.unwatch();
    if (!link) return;
    const check = () => {
      const view = link.state;
      const waiting = this.#awaiting;
      if (!waiting) return;
      if (view.running || view.turn !== undefined) waiting.seen = true;
      else if (waiting.seen || (byWords && replyTo(view, text) !== undefined)) {
        waiting.unwatch();
        this.#awaiting = undefined;
        this.#send({ type: 'reply', text: (waiting.seen ? finishedReply({ running: true, turn: undefined, error: undefined, messages: [] }, view) : replyTo(view, text))?.text ?? '' });
      }
    };
    const unwatch = link.subscribe(check);
    this.#awaiting = { text, seen, unwatch };
    check();
  }

  async #run(effect: HandsFreeEffect) {
    try {
      switch (effect.do) {
        case 'listen':
          this.#listen();
          break;
        case 'transcribe': {
          const taken = this.#recording;
          this.#recording = undefined;
          if (!taken) return;
          this.#send({ type: 'transcript', text: await transcribe(await taken.stop(), { profile: this.#profile }) });
          break;
        }
        case 'send': {
          this.#publish({ heard: effect.text });
          const link = this.#link;
          if (!link) return this.#send({ type: 'failed', message: 'There is no chat to send to.' });
          // Armed before sending: the reply is whatever finishes after this turn starts.
          this.#awaiting = { text: effect.text, seen: false, unwatch: () => undefined };
          this.#watch(effect.text, false);
          if (!(await link.send(effect.text))) {
            this.#awaiting?.unwatch();
            this.#awaiting = undefined;
            this.#send({ type: 'failed', message: link.state.error ?? 'Hermes did not take that message.' });
          }
          break;
        }
        case 'speak':
          await readAloud.toggle('hands-free', speechParts(speakable(effect.text)));
          if (readAloud.state().error) return this.#send({ type: 'failed', message: readAloud.state().error ?? 'Hermes could not speak that.' });
          this.#send({ type: 'spoken' });
          break;
        case 'close':
          this.#close(this.#machine.error);
          break;
      }
    } catch (error) {
      this.#send({ type: 'failed', message: error instanceof Error ? error.message : String(error) });
    }
  }
}

/** The page's one hands-free session. */
export const handsFree = new HandsFreeSession();

export function useHandsFree(): HandsFreeSnapshot {
  return useSyncExternalStore(handsFree.subscribe, handsFree.snapshot);
}
