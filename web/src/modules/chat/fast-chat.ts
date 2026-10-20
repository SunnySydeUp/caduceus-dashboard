// Fast chat (M1 #18): prompts that go straight to a model through Hermes's `llm.oneshot`, with no agent, no tools and no session. The conversation lives
// only in this object, in the browser tab: Hermes holds no record of it and Caduceus keeps none. No DOM and no React.
import { CADUCEUS_SESSION_SOURCE } from '@caduceus/contracts/caduceus-api';
import { isRecord } from '@caduceus/contracts/policy/guards';
import type { TieredRequest, TieredResult } from '../../tiered-fetch.ts';
import { createStore, type Store } from './store.ts';

/** The one gateway call a fast chat makes. The page's Hermes client has this shape. */
export interface FastClient {
  request<Result>(method: string, params: Record<string, unknown>): Promise<Result>;
}

export interface FastMessage {
  role: 'user' | 'assistant';
  text: string;
}

export interface FastState {
  messages: readonly FastMessage[];
  /** A call is on its way to Hermes. */
  waiting: boolean;
  /** How many of the earliest messages the last call did not carry: the conversation had outgrown what one call takes. */
  leftOut: number;
  /** What Hermes said when the last call failed (the model is not available, the provider's rate limit…); the owner can retry it. */
  failure: string | undefined;
}

/** Whether the owner has agreed, in this tab, to fast calls. A tab is a page load: a reload asks again. */
export interface TabConsent {
  given: boolean;
}

/** The page's own: every fast chat of the tab shares it. */
export const tabConsent: TabConsent = { given: false };

export interface FastOptions {
  client: FastClient;
  profile: string;
  /** The model the call is made on, for the question the owner is asked. */
  model?(): string | undefined;
  /**
   * The chat's own Hermes session, when it has one: `llm.oneshot` takes no model, only a session that lends its model (what the owner picked for the chat), else it
   * uses the profile's. A fast chat never creates a session to have one.
   */
  session?(): string | undefined;
  /** Asked before the first fast call of a tab (T1): the call costs tokens with no agent session behind it. Resolves true when the owner agrees. */
  confirm(request: { profile: string; model: string | undefined }): Promise<boolean>;
  consent?: TabConsent;
}

/** How a request that is not a plain read is sent (`createTieredFetch`): the page's own dialog stands in front of it. */
export type SendTiered = (request: TieredRequest) => Promise<TieredResult>;

/** How Continue as chat ended: the stored session that now holds the conversation, or why not. */
export type ContinueOutcome = { kind: 'continued'; storedId: string } | { kind: 'cancelled' } | { kind: 'failed'; message: string };

export interface FastChat extends Store<FastState> {
  /** Sends a prompt as the next message. Resolves true when the model answered; false when the owner did not agree to the call, or the call failed (`state.failure` says why). */
  send(text: string): Promise<boolean>;
  /** Asks again after a failure, for the same last message. False when nothing failed. */
  retry(): Promise<boolean>;
  /**
   * Continue as chat: Hermes's session import (T1) writes the conversation as a normal session of this profile, with the same words and no model call, and the
   * page opens it. The fast conversation ends with it, since the chat now holds it.
   */
  continueAsChat(request: { send: SendTiered }): Promise<ContinueOutcome>;
  /** Forgets the conversation. The owner chose to leave it, or to start again. */
  clear(): void;
}

const INSTRUCTIONS =
  'You are a helpful assistant in a quick chat. The conversation so far follows, as "You:" (the person) and "Assistant:" (you). Write the assistant\'s next reply to the last "You:" message, as plain Markdown, without an "Assistant:" label.';
const MAX_TOKENS = 1024;

const SPEAKER: Record<FastMessage['role'], string> = { user: 'You', assistant: 'Assistant' };

/** How much of a conversation goes into one call: about 8,000 tokens of words. A longer one is sent from its newest messages back. */
export const FAST_INPUT_CHARS = 32_000;

/**
 * The conversation as one block of words under who said them (a one-shot call takes a single message, so the history goes in it), and how many of the earliest
 * messages had to be left out to fit. The newest message always goes, whatever its size.
 */
function conversationText(messages: readonly FastMessage[]): { input: string; leftOut: number } {
  const turns = messages.map((message) => `${SPEAKER[message.role]}: ${message.text}`);
  let kept = 0;
  let size = 0;
  for (const turn of turns.toReversed()) {
    const next = size + turn.length + (kept > 0 ? 2 : 0);
    if (kept > 0 && next > FAST_INPUT_CHARS) break;
    kept += 1;
    size = next;
  }
  return { input: turns.slice(turns.length - kept).join('\n\n'), leftOut: turns.length - kept };
}

export function createFastChat({ client, profile, model, session, confirm, consent = tabConsent }: FastOptions): FastChat {
  const store = createStore<FastState>({ messages: [], waiting: false, leftOut: 0, failure: undefined });
  /** How many times the conversation was cleared: a call that began before a clear has nothing to answer. */
  let cleared = 0;
  const clear = () => {
    cleared += 1;
    store.set({ messages: [], waiting: false, leftOut: 0, failure: undefined });
  };
  /** Asks Hermes's one-shot model for the reply to the conversation as it stands, which ends on a message of the owner's. */
  const ask = async (): Promise<boolean> => {
    const { input, leftOut } = conversationText(store.state.messages);
    store.set({ waiting: true, leftOut, failure: undefined });
    const asked = cleared;
    try {
      const lender = session?.();
      const { text } = await client.request<{ text: string }>('llm.oneshot', {
        profile,
        instructions: INSTRUCTIONS,
        input,
        max_tokens: MAX_TOKENS,
        ...(lender === undefined ? {} : { session_id: lender }),
      });
      if (asked !== cleared) return false;
      store.set((state) => ({ messages: [...state.messages, { role: 'assistant', text: text.trim() }], waiting: false }));
      return true;
    } catch (error) {
      if (asked !== cleared) return false;
      store.set({ waiting: false, failure: error instanceof Error ? error.message : String(error) });
      return false;
    }
  };
  return {
    get state() {
      return store.state;
    },
    subscribe: store.subscribe,
    until: store.until,
    async send(text) {
      if (store.state.waiting) return false;
      if (!consent.given) {
        if (!(await confirm({ profile, model: model?.() }))) return false;
        consent.given = true;
      }
      store.set((state) => ({ messages: [...state.messages, { role: 'user', text }] }));
      return ask();
    },
    async retry() {
      if (store.state.waiting || store.state.failure === undefined) return false;
      return ask();
    },
    clear,
    async continueAsChat({ send }) {
      const { messages } = store.state;
      if (messages.length === 0) return { kind: 'failed', message: 'There is nothing to continue yet.' };
      const id = crypto.randomUUID();
      const result = await send({
        method: 'POST',
        path: '/api/sessions/import',
        body: { profile, sessions: [{ id, source: CADUCEUS_SESSION_SOURCE, started_at: Date.now() / 1000, messages: messages.map((message) => ({ role: message.role, content: message.text })) }] },
        confirm: {
          title: `Continue this conversation as a chat in ${profile}?`,
          text: 'Hermes saves it as a session in this profile’s history, with the words as they are here, and you carry on with its agent and tools. This quick chat is closed.',
          profile,
          confirmLabel: 'Continue as chat',
        },
      });
      if (result.kind === 'cancelled') return result;
      if (result.kind === 'refused') return { kind: 'failed', message: result.refusal.message };
      const body: unknown = await result.response.json().catch(() => undefined);
      const imported = isRecord(body) && typeof body.imported === 'number' ? body.imported : 0;
      if (!result.response.ok || imported !== 1) return { kind: 'failed', message: isRecord(body) && typeof body.detail === 'string' ? body.detail : `Hermes did not save the conversation (it answered ${result.response.status}).` };
      clear();
      return { kind: 'continued', storedId: id };
    },
  };
}
