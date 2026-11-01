// What the owner is told when a read fails: a plain cause, never a status code. The code and the raw words stay available as the detail (a Details disclosure, or text the owner
// can copy). Pure; `useBlock` is the one place a block's failure becomes words, and uses this.

/** A failure as a screen shows it: `message` is the cause in plain words; `detail` is what was said before it was made plain, when that differs. */
export interface PlainFailure {
  message: string;
  detail?: string;
}

/** The status each bare reason phrase stands for (what a proxy or a framework answers with no words of its own). */
const PHRASE_STATUS: Record<string, number> = {
  'bad request': 400,
  unauthorized: 401,
  forbidden: 403,
  'not found': 404,
  'method not allowed': 405,
  'request timeout': 408,
  'too many requests': 429,
  'internal server error': 500,
  'not implemented': 501,
  'bad gateway': 502,
  'service unavailable': 503,
  'gateway timeout': 504,
};

/** The words for a status: what went wrong from the owner's side, with `who` (Hermes or Caduceus) as the one that answered. */
function causeOf(status: number, who: string): string {
  if (status === 404 || status === 405 || status === 501) return `${who} doesn’t offer this yet`;
  if (status === 401 || status === 403) return `${who} didn’t allow this`;
  if (status === 408 || status === 504) return `${who} took too long to answer`;
  if (status === 429) return `${who} is busy right now`;
  if (status >= 500) return `${who} had a problem answering`;
  return `${who} couldn’t answer this`;
}

/** The sentences the app builds from a status: "Hermes answered HTTP 404", "Caduceus answered HTTP 502.", and "GET /api/profiles: HTTP 404". */
const STATUS_SENTENCE = /^(?:(Hermes|Caduceus) answered HTTP (\d{3})|GET \S+: HTTP (\d{3}))\.?$/;

/**
 * A failure's words, made plain: a message that is only a status ("Hermes answered HTTP 404", "Not Found") becomes its cause ("Hermes doesn’t offer this yet") with the original
 * as `detail`. Any other message is already a sentence someone wrote for the owner, and stays as it is.
 */
export function plainFailure(raw: string): PlainFailure {
  const text = raw.trim();
  const sentence = STATUS_SENTENCE.exec(text);
  if (sentence) return { message: causeOf(Number(sentence[2] ?? sentence[3]), sentence[1] ?? 'Hermes'), detail: text.replace(/\.$/, '') };
  const status = PHRASE_STATUS[text.replace(/\.$/, '').toLowerCase()];
  if (status !== undefined) return { message: causeOf(status, 'Hermes'), detail: text.replace(/\.$/, '') };
  return { message: raw };
}
