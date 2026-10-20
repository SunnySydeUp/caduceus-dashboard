// What the Caduceus server tells the page about a profile's Hindsight (R10, M4 #10) and about its external notes sources (R11). Hindsight's own
// answers (memories, directives, mental models, recall, reflect) are passed on as Hindsight sent them and read by the page (`web/src/modules/memory/hindsight-model.ts`);
// only the status and the notes answers are Caduceus's own shapes. No answer ever holds a credential.

/** One memory bank as the page lists it. */
export interface HindsightBankRow {
  id: string;
  name: string | null;
  mission: string | null;
  facts: number;
  updatedAt: string | null;
}

/**
 * Where Hindsight stands for a profile:
 * - `off`: Hindsight is not the profile's memory provider;
 * - `embedded`: it runs inside Hermes on a port of its own, which Caduceus cannot reach;
 * - `unreachable`: its API did not answer;
 * - `rejected`: it answered and refused the key (or there is none);
 * - `connected`: its banks were listed.
 */
export type HindsightState = 'off' | 'embedded' | 'unreachable' | 'rejected' | 'connected';

export interface HindsightStatus {
  state: HindsightState;
  /** What the page says about the state, in a sentence. */
  message: string;
  /** Hermes's connection mode (`cloud`, `local_external`, `local_embedded`) and the API address it is set to, without any credential in it; absent when off. */
  mode?: string;
  apiUrl?: string;
  /** Set when Hermes's address changed after the key was first used: the key is held back from `apiUrl`, and this is the address it was approved for. */
  keyPinnedTo?: string;
  /** The bank Hermes writes to for this profile, when its settings name one (a bank template is shown rendered for the profile). */
  bank?: string;
  /** Hindsight's version, when it said. */
  version?: string;
  /** The banks Hindsight lists now (`connected`), or the ones it listed the last time it answered (`unreachable`, `rejected`). */
  banks: HindsightBankRow[];
  /** `banks` is from an earlier answer. */
  stale?: boolean;
}

/** A tool of a notes source that Caduceus may call, by what it does. */
export interface NotesTools {
  search: string | undefined;
  read: string | undefined;
}

/** One MCP server of a profile's Hermes config, as the Notes list shows it. */
export interface NotesSourceRow {
  name: string;
  transport: 'stdio' | 'http' | 'unsupported';
  /** The owner marked it as a notes source. */
  source: boolean;
  /** It is turned off in Hermes's config. */
  disabled: boolean;
  /** A stdio server's command has been approved to run (the owner typed its name): `true` for a server that is not a command. */
  approved: boolean;
  /** The command line of an stdio server, for the owner to read before approving; no environment values. */
  command?: string;
  /** Why Caduceus cannot use it as a source (an `unsupported` transport). */
  note?: string;
}

export interface NotesSources {
  sources: NotesSourceRow[];
}

/** A search hit: a snippet of a note and what to open it with. */
export interface NoteHit {
  ref: string;
  title: string;
  snippet: string;
}

export interface NotesSearchAnswer {
  /** The tool that ran. */
  tool: string;
  hits: NoteHit[];
  /** The server's text, when it did not answer in a form that gives hits. */
  text?: string;
}

export interface NotePreview {
  tool: string;
  title: string;
  /** The note's text, to be shown read-only. */
  text: string;
  /** The note is longer than what is given. */
  truncated: boolean;
}
