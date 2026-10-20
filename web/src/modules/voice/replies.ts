// Telling when a reply is done (M7 #07), free of the DOM and of React: auto-read and hands-free mode speak a reply once its turn has finished in front
// of the owner. The chat engine's state is read through the few fields this needs.

export interface ReplyView {
  running: boolean;
  /** The turn in progress, or the last one that did not complete. */
  turn: unknown;
  error: string | undefined;
  messages: readonly { id?: number; role: 'user' | 'assistant'; text: string; stopped?: true; failed?: { error: string } }[];
}

/**
 * The reply to speak when `state` is the first settled state after `previous` was working; otherwise undefined: nothing to say yet, nothing new
 * (a chat that was opened settled), or a reply that is not to be spoken (stopped, failed, or no words).
 */
export function finishedReply(previous: ReplyView, state: ReplyView): ReplyView['messages'][number] | undefined {
  const wasWorking = previous.running || previous.turn !== undefined;
  if (!wasWorking || state.running || state.turn !== undefined || state.error !== undefined) return undefined;
  const last = state.messages.at(-1);
  if (last?.role !== 'assistant' || last.stopped || last.failed || last.text.trim() === '') return undefined;
  return last;
}

/** Whether the reply is one to speak: it has words and was neither stopped nor a failure. */
const speakableReply = (message: ReplyView['messages'][number] | undefined): message is ReplyView['messages'][number] => message?.role === 'assistant' && !message.stopped && !message.failed && message.text.trim() !== '';

/**
 * The reply to the last message of the owner's that said `text`, once the chat has settled: how a screen that took over a chat (the first message of a
 * new chat moves it to its own address) finds the reply to a message that was sent from the screen before it.
 */
export function replyTo(state: ReplyView, text: string): ReplyView['messages'][number] | undefined {
  if (state.running || state.turn !== undefined || state.error !== undefined) return undefined;
  const sent = state.messages.findLastIndex((message) => message.role === 'user' && message.text.trim() === text.trim());
  if (sent < 0) return undefined;
  const reply = state.messages.slice(sent + 1).findLast((message) => message.role === 'assistant');
  return speakableReply(reply) ? reply : undefined;
}
