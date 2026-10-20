// Asking Hermes's title model for a new name for a chat (M1 #12): pure. Hermes names a new chat itself after its first exchange; Regenerate title asks
// the same model slot (`auxiliary.title_generation`, through `llm.oneshot`) again, from the chat's first message, and Hermes keeps the result.
import { splitAttachments } from './message-attachments.ts';

/** What the title model is told. Hermes's own titler says the same in more words; this is the part that matters for a one-off ask. */
export const TITLE_INSTRUCTIONS =
  'You name conversations. Given the opening message of a conversation, answer with a title of 3 to 7 words in the language of the message. ' +
  'Answer with the title only: no quotes, no markdown, no full stop, and never answer the message itself.';

/** How much of the opening message the title model reads. */
const MAX_INPUT_CHARS = 1000;

/** The most words a title may have: a longer answer is a model that answered the message instead of naming it. */
const MAX_TITLE_WORDS = 12;

/** What goes to the title model: the owner's own words of the first message, without the attachment lines. */
export const titleInput = (firstMessage: string): string => splitAttachments(firstMessage).body.trim().slice(0, MAX_INPUT_CHARS);

/** The title out of the model's answer: its first line, without quotes, markdown or a closing full stop; undefined when it is empty or reads as an answer, not a title. */
export function cleanTitle(answer: string): string | undefined {
  const line = (answer.split('\n').find((part) => part.trim() !== '') ?? '')
    .replace(/^\s*(?:title\s*:\s*)?/i, '')
    .replace(/^[\s"'“”‘’`*_#>-]+|[\s"'“”‘’`*_]+$/g, '')
    .replace(/[.。]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (line === '' || line.split(' ').length > MAX_TITLE_WORDS) return undefined;
  return line;
}

/** How many numbered titles are tried before giving up. */
export const MAX_TITLE_ATTEMPTS = 9;
