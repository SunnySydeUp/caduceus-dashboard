// A handoff summary (M1 #16): a short note on a chat for whoever picks it up, written by Hermes's one-shot model (`llm.oneshot`) on request.
// It costs a model call, so the page asks the owner first (T1). Nothing is stored: not here, and not in Hermes (the call is stateless and the
// chat gets no message), so the note lives only in the banner that shows it. No DOM and no React.
import type { ChatMessage } from './chat-session.ts';
import { splitAttachments } from './message-attachments.ts';
import { plainText } from './message-actions.ts';

/** How much of a chat goes into one request: about 8,000 tokens of words. A longer chat is summarised from its newest part. */
export const SUMMARY_INPUT_CHARS = 32_000;

const INSTRUCTIONS =
  'Write a handoff summary of the conversation below for someone who is picking it up. In plain text, under 200 words, say what it is about, what was decided or done, and what is still open. Do not quote long passages, and do not address the reader.';

/** What is asked of the one-shot model: the chat as words under who said them (the owner's attachments and the agent's tool cards left out), and whether the start of the chat had to be left out to fit. */
export function summaryRequest(messages: readonly ChatMessage[], names: { user: string; assistant: string }): { instructions: string; input: string; truncated: boolean } {
  const turns = messages.flatMap((message) => {
    if (message.activity || message.failed) return [];
    const words = plainText(message.role === 'user' ? splitAttachments(message.text).body : message.text).trim();
    return words === '' ? [] : [`${names[message.role]}: ${words}`];
  });
  // From the newest turn back, while it fits; a turn that does not fit whole ends it.
  const kept: string[] = [];
  let size = 0;
  for (const turn of turns.toReversed()) {
    const next = size + turn.length + (kept.length > 0 ? 2 : 0);
    if (next > SUMMARY_INPUT_CHARS) break;
    kept.unshift(turn);
    size = next;
  }
  return { instructions: INSTRUCTIONS, input: kept.join('\n\n'), truncated: kept.length < turns.length };
}

/** Asks Hermes for the note. The call is a read of the model (`llm.oneshot`): it writes nothing to the session. */
export async function generateSummary(client: { request<Result>(method: string, params: Record<string, unknown>): Promise<Result> }, { profile, instructions, input }: { profile: string; instructions: string; input: string }): Promise<string> {
  const { text } = await client.request<{ text: string }>('llm.oneshot', { profile, instructions, input, max_tokens: 600 });
  return text.trim();
}
