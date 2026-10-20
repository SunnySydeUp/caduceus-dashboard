// Links that start a chat (M1 #17): `/chat/new?prompt=…&profile=…` opens a new chat in that profile with the words in the message box. They are only ever a
// draft: nothing here sends, and the page takes them out of the address once the box has them (a prompt can be long, and belongs in no history entry or
// bookmark of an open tab). No DOM and no React: the address comes in as the raw query string, because the router reads `?prompt=123` as a number.

/** What a new-chat link asked for, and what is left of the address once the page has taken it. */
export interface NewChatLink {
  /** The words for the message box; `undefined` when the link has none or only blanks. */
  prompt: string | undefined;
  /** The profile the link named when Hermes has none of that name (the tab then keeps its own profile), else `undefined`. */
  unknownProfile: string | undefined;
  /** The query string to put in the address in place: the link without its prompt and without an unknown profile (`''` or `?…`). */
  remaining: string;
}

/** The sentence that says the link's profile was not used. */
export const UNKNOWN_PROFILE_NOTICE = (profile: string): string => `There is no profile “${profile}”, so this chat uses your current profile.`;

/** Reads the query string of a `/chat/new` address against the profiles Hermes has. A parameter given twice counts as its last value. */
export function resolveNewChatLink(search: string, profiles: readonly string[]): NewChatLink {
  const query = new URLSearchParams(search);
  const prompt = query.getAll('prompt').at(-1);
  const profile = query.getAll('profile').at(-1);
  query.delete('prompt');
  query.delete('profile');
  const unknownProfile = profile !== undefined && profile !== '' && !profiles.includes(profile) ? profile : undefined;
  if (profile !== undefined && profile !== '' && unknownProfile === undefined) query.set('profile', profile);
  const text = query.toString();
  return { prompt: prompt === undefined || prompt.trim() === '' ? undefined : prompt, unknownProfile, remaining: text === '' ? '' : `?${text}` };
}
