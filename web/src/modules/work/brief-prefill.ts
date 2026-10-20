// What Chat's "Make this a task" gives the Brief editor to start from: a message, or a whole chat, as a title, a Goal, some Context and a
// reference to the source session. Pure: the editor takes the result through `brief-handoff.ts`.
import type { BriefPrefill } from './brief-handoff.ts';

type Role = 'user' | 'assistant';
interface SourceSession {
  id: string;
  title: string | null;
}

const TITLE_MAX = 80;
const TURN_MAX = 1500;
const CONTEXT_MAX = 12_000;
const TURN_CUT = ' …';
const REST_NOTE = '(The rest of the chat is in the source session.)';
const ASSISTANT_GOAL = 'Act on this reply from the earlier chat.';

/** One line from some Markdown: the first line with words in it, without the heading, quote, list and emphasis marks, cut at 80 characters. */
function titleOf(text: string): string {
  for (const line of text.split('\n')) {
    const words = line.replaceAll('`', '').replace(/^[#>*\-\s]+/, '').replaceAll('*', '').replace(/\s+/g, ' ').trim();
    if (words === '') continue;
    return words.length <= TITLE_MAX ? words : `${words.slice(0, TITLE_MAX - 1).trimEnd()}…`;
  }
  return '';
}

function referencesOf(session: SourceSession, messageLink: string | undefined): string {
  const name = session.title?.replace(/\s+/g, ' ').trim() || 'Untitled chat';
  return [`- Chat session: ${name} (session id \`${session.id}\`)`, ...(messageLink === undefined ? [] : [`- Message: ${messageLink}`])].join('\n');
}

/** A brief that starts from one chat message. A message the owner wrote is the goal; a reply from Hermes is the context to act on. */
export function prefillFromMessage({ text, role, session, messageLink }: { text: string; role: Role; session: SourceSession; messageLink?: string }): BriefPrefill {
  const body = text.trim();
  const references = referencesOf(session, messageLink);
  if (body === '') return { title: '', goal: '', context: '', references };
  return role === 'user' ? { title: titleOf(body), goal: body, context: '', references } : { title: titleOf(body), goal: ASSISTANT_GOAL, context: body, references };
}

/** A brief that starts from a whole chat: its first user message is the goal, and the other turns, shortened, are the context. */
export function prefillFromSession({ messages, session }: { messages: readonly { role: Role; text: string }[]; session: SourceSession }): BriefPrefill {
  const first = messages.findIndex((message) => message.role === 'user' && message.text.trim() !== '');
  const goal = first < 0 ? '' : messages[first]!.text.trim();
  const turns = messages
    .filter((message, index) => index !== first && message.text.trim() !== '')
    .map(({ role, text }) => {
      const body = text.trim();
      return `**${role === 'user' ? 'You' : 'Hermes'}:** ${body.length > TURN_MAX ? `${body.slice(0, TURN_MAX)}${TURN_CUT}` : body}`;
    });
  const kept: string[] = [];
  let length = 0;
  for (const turn of turns) {
    const next = length + (kept.length === 0 ? 0 : 2) + turn.length;
    if (next > CONTEXT_MAX) break;
    kept.push(turn);
    length = next;
  }
  const context = kept.length < turns.length ? [...kept, REST_NOTE].join('\n\n') : kept.join('\n\n');
  const title = titleOf(session.title ?? '') || titleOf(goal);
  return { title, goal, context, references: referencesOf(session, undefined) };
}
