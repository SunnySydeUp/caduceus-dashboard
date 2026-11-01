// What the owner is told when something could not be read or done: one table of causes, the same on every surface (the connection banner and strip, Talk, Work, Today). A cause
// names the party that did not answer (this device, Caduceus on the Mac, or Hermes) and never a status code; the code and the raw words stay available as the detail (a Details
// disclosure, or text the owner can copy). Pure; `useBlock` is where a block's failure becomes words, and the other surfaces call `plainFailure` the same way.

/** A failure as a screen shows it: `message` is the cause in plain words; `detail` is what was said before it was made plain, when that differs. */
export interface PlainFailure {
  message: string;
  detail?: string;
}

/** The causes, by the party that did not answer. */
export const CAUSE = {
  /** The device has no network: nothing can be asked until it has. */
  offline: 'You are offline',
  /** The device has a network and Caduceus, the server on the Mac, did not answer. */
  mac: 'Can’t reach your Mac',
  /** Caduceus answered, and Hermes behind it did not (or is down). */
  hermesSilent: 'Hermes isn’t answering',
  /** Hermes answered that it has no such route. */
  notOffered: 'Hermes doesn’t offer this yet',
} as const;

/** What the owner can check when Caduceus does not answer: the Mac is the thing that stopped. */
export const MAC_CHECK = 'Check that the Mac is awake and switched on, and that it is on your tailnet.';

/** What a browser says when `fetch` never got an answer. */
const NETWORK_FAILURE = /^(?:failed to fetch|load failed|fetch failed|network request failed|networkerror when attempting to fetch resource\.?|the network connection was lost\.?|the internet connection appears to be offline\.?)$/i;

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
  if ((status === 502 || status === 503) && who === 'Hermes') return CAUSE.hermesSilent;
  if (status === 401 || status === 403) return `${who} didn’t allow this`;
  if (status === 408 || status === 504) return `${who} took too long to answer`;
  if (status === 429) return `${who} is busy right now`;
  if (status >= 500) return `${who} had a problem answering`;
  return `${who} couldn’t answer this`;
}

/** The sentences the app builds from a status: "Hermes answered HTTP 404", "Hermes answered 404 to /api/sessions", "Caduceus answered HTTP 502.", and "GET /api/profiles: HTTP 404". */
const STATUS_SENTENCE = /^(?:(Hermes|Caduceus) answered (?:HTTP )?(\d{3})(?: to \S+)?|GET \S+: HTTP (\d{3}))\.?$/;

/**
 * A failure's words, made plain: a message that is only a status ("Hermes answered HTTP 404", "Not Found") or a browser's "Failed to fetch" becomes its cause with the original as
 * `detail`. `online` is whether the device has a network: "Failed to fetch" is then Caduceus on the Mac not answering, otherwise it is the device being offline. Any other
 * message is already a sentence someone wrote for the owner, and stays as it is.
 */
export function plainFailure(raw: string, online: boolean = typeof navigator === 'undefined' || navigator.onLine): PlainFailure {
  const text = raw.trim();
  const unsaid = text.replace(/\.$/, '');
  if (NETWORK_FAILURE.test(text)) return { message: online ? CAUSE.mac : CAUSE.offline, detail: unsaid };
  if (/^Hermes did not answer$/i.test(unsaid)) return { message: CAUSE.hermesSilent };
  const sentence = STATUS_SENTENCE.exec(text);
  if (sentence) return { message: causeOf(Number(sentence[2] ?? sentence[3]), sentence[1] ?? 'Hermes'), detail: unsaid };
  const status = PHRASE_STATUS[unsaid.toLowerCase()];
  if (status !== undefined) return { message: causeOf(status, 'Hermes'), detail: unsaid };
  return { message: raw };
}

/** The same for anything a promise rejected with. */
export function plainFailureOf(error: unknown, online?: boolean): PlainFailure {
  return plainFailure(error instanceof Error ? error.message : String(error), online);
}
