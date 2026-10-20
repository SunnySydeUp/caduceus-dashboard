// The composer's draft (M1 #11), free of the DOM and of React: what the page does with the draft the Caduceus server keeps for (profile, session or `new`).
// It saves after a pause in typing and when the page is hidden, uploads attachments as they are added (so that a draft survives a reload with them),
// deletes the draft the moment the composer is empty, and, when another device has written the draft, never overwrites typed words without saying so.
//
// Which words are kept, and the caps, are the server's (`server/src/chat-drafts.ts`, `contracts/chat-drafts.ts`). Whatever it refuses stays in the
// page, with the reason. Nothing here talks to Hermes: a draft goes to Hermes only when the owner presses Send, like any typed words.
import type { Draft, DraftAttachment, DraftReply } from '@caduceus/contracts/chat-drafts';
import type { Attachment } from './attachments.ts';
import { createStore, type Store } from './store.ts';

/** What the composer holds: its words and its attachments. */
export interface DraftContent {
  text: string;
  attachments: readonly Attachment[];
}

/** How long typing must pause before a save (about one second). */
export const SAVE_PAUSE_MS = 1000;

export interface Timers {
  set(run: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const browserTimers: Timers = { set: (run, ms) => setTimeout(run, ms), clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) };

/**
 * What the owner is told. `elsewhere`: another device wrote this draft. `how` says how it came to the page: `replaced` (our save replaced a newer draft: ours
 * stands, theirs is one tap away), `newer` (it changed while we were typing: nothing typed is touched), `found` (a draft was there when the page opened and
 * words were typed already), `updated` (it changed while we had typed nothing new, so the page took it).
 * `refused` and `readonly`: the server did not keep it, and the message says why; it stays in this page until sent or cleared.
 */
export type DraftNotice = { kind: 'elsewhere'; how: 'replaced' | 'newer' | 'found' | 'updated'; theirs: Draft } | { kind: 'refused'; message: string } | { kind: 'readonly'; message: string };

/** An attachment the server did not keep with the draft, and why. It stays attached to the message. */
export interface Unkept {
  id: string;
  name: string;
  reason: string;
}

export interface DraftView {
  notice: DraftNotice | undefined;
  unkept: Unkept[];
}

export interface DraftSyncOptions {
  profile: string;
  /** A stored session's id, or `new` (`NEW_CHAT` in the contract). */
  session: string;
  /** The page's way to call the server; `fetch` in the browser, the test server's in a test. */
  fetcher?: (route: string, init: RequestInit) => Promise<Response>;
  timers?: Timers;
  /** The composer is given this: a draft that was kept (opening the session, or taking another device's version). */
  adopt(content: DraftContent): void;
  /** Whether the server holds a draft for this key now (for the session list's indicator). */
  onPresence?(has: boolean): void;
}

export interface DraftSync {
  readonly store: Store<DraftView>;
  /** Reads the draft kept for this key and gives it to the composer if the composer is empty. Saves wait for it. */
  load(content: DraftContent): Promise<void>;
  /** The composer changed: attachments go up now, the words are saved after a pause, and an empty composer deletes the draft now. */
  change(content: DraftContent): void;
  /** Saves now (the page is being hidden: attachments still on their way are left to the next save). */
  flush(hiding?: boolean): void;
  /** Reads the draft again (the page was looked at again) and deals with one that another device wrote. */
  refresh(content: DraftContent): Promise<void>;
  /** Puts the other device's version into the composer. */
  takeTheirs(): Promise<void>;
  /** The words in the composer stand: they are saved over the other device's version. */
  keepMine(): void;
  dismiss(): void;
  /** Resolves when everything started so far is done. */
  idle(): Promise<void>;
  /** The composer is leaving: what it holds is saved. */
  dispose(): void;
}

const DRAFT = '/_caduceus/api/chat/draft';

const isEmpty = (content: DraftContent) => content.text.trim() === '' && content.attachments.length === 0;

/** What the server has for a draft: the words and the server's id of each attachment, in order. */
interface Snapshot {
  text: string;
  ids: string[];
}

const sameSnapshot = (a: Snapshot, b: Snapshot) => a.text === b.text && a.ids.length === b.ids.length && a.ids.every((id, index) => id === b.ids[index]);

export function createDraftSync({ profile, session, fetcher = (route, init) => fetch(route, init), timers = browserTimers, adopt, onPresence }: DraftSyncOptions): DraftSync {
  const store = createStore<DraftView>({ notice: undefined, unkept: [] });
  const key = `?profile=${encodeURIComponent(profile)}&session=${encodeURIComponent(session)}`;
  /** What the composer holds now. */
  let local: DraftContent = { text: '', attachments: [] };
  /** The revision of the draft this page last saw or wrote: 0 when there was none. */
  let base = 0;
  /** What the server holds for the key as far as this page knows; `undefined` when it has none. */
  let saved: Snapshot | undefined;
  let loaded = false;
  /** The server's id of each attachment the composer holds, by the composer's id. */
  const serverIds = new Map<string, string>();
  const unkept = new Map<string, Unkept>();
  let timer: unknown;
  let chain: Promise<unknown> = Promise.resolve();
  const enqueue = (job: () => Promise<void>) => {
    chain = chain.then(job).catch(() => undefined);
  };

  const publishUnkept = () => store.set({ unkept: [...unkept.values()] });
  const notify = (notice: DraftNotice | undefined) => store.set({ notice });
  const present = (has: boolean) => onPresence?.(has);
  const snapshotOf = (content: DraftContent): Snapshot => ({ text: content.text, ids: content.attachments.flatMap((attachment) => serverIds.get(attachment.id) ?? []) });

  const answer = async (res: Response): Promise<{ error?: string; message?: string }> => (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  /** What a refusal means for the page: read-only mode is its own note, everything else is a reason the draft is not kept. */
  const refusal = async (res: Response): Promise<{ readonly: boolean; message: string }> => {
    const body = await answer(res);
    return { readonly: body.error === 'read-only', message: body.message ?? `Caduceus did not keep the draft (HTTP ${res.status}).` };
  };

  /** The attachments the composer holds are on the server: the ones that are not yet go up, one after the other. */
  async function upload(): Promise<void> {
    const held = new Set(local.attachments.map((attachment) => attachment.id));
    for (const id of [...serverIds.keys(), ...unkept.keys()]) {
      if (held.has(id)) continue;
      serverIds.delete(id);
      unkept.delete(id);
    }
    for (const attachment of local.attachments) {
      if (serverIds.has(attachment.id) || unkept.has(attachment.id)) continue;
      const query = `${key}&name=${encodeURIComponent(attachment.name)}&kind=${attachment.kind}${attachment.pasted ? '&pasted=1' : ''}${attachment.origin ? `&origin=${encodeURIComponent(attachment.origin)}` : ''}`;
      let res: Response;
      try {
        res = await fetcher(`${DRAFT}/attachments${query}`, { method: 'POST', headers: { 'content-type': attachment.body.type || 'application/octet-stream' }, body: attachment.body });
      } catch {
        // Caduceus cannot be reached: the next change tries again.
        continue;
      }
      if (res.status === 201) serverIds.set(attachment.id, ((await res.json()) as { attachment: DraftAttachment }).attachment.id);
      else {
        const refused = await refusal(res);
        if (refused.readonly) notify({ kind: 'readonly', message: refused.message });
        else unkept.set(attachment.id, { id: attachment.id, name: attachment.name, reason: refused.message });
      }
    }
    publishUnkept();
  }

  async function clear(): Promise<void> {
    if (saved === undefined) return;
    try {
      const res = await fetcher(`${DRAFT}${key}`, { method: 'DELETE', keepalive: true });
      if (res.status === 204) {
        saved = undefined;
        present(false);
      } else {
        const refused = await refusal(res);
        if (refused.readonly) notify({ kind: 'readonly', message: refused.message });
      }
    } catch {
      // The draft stays on the server until the next change.
    }
  }

  async function save(hiding = false): Promise<void> {
    const content = local;
    if (isEmpty(content)) return clear();
    if (!hiding) await upload();
    const snapshot = snapshotOf(content);
    if (saved && sameSnapshot(saved, snapshot)) return;
    let res: Response;
    try {
      res = await fetcher(`${DRAFT}${key}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: content.text, attachments: snapshot.ids, base }), keepalive: true });
    } catch {
      notify({ kind: 'refused', message: 'Caduceus could not be reached, so this draft is not saved yet. It is saved when you type again or the connection is back.' });
      return;
    }
    if (!res.ok) {
      const refused = await refusal(res);
      notify(refused.readonly ? { kind: 'readonly', message: refused.message } : { kind: 'refused', message: refused.message });
      return;
    }
    const reply = (await res.json()) as DraftReply;
    base = reply.draft?.revision ?? base;
    saved = reply.draft ? snapshot : undefined;
    present(reply.draft !== null);
    // A note about a refusal ends with the save that was not refused; a note about another device stays until the owner answers it.
    const current = store.state.notice;
    if (reply.replaced) notify({ kind: 'elsewhere', how: 'replaced', theirs: reply.replaced });
    else if (current && current.kind !== 'elsewhere') notify(undefined);
  }

  /** The composer's own copy of a draft the server holds: its attachments are read back. */
  async function contentOf(draft: Draft): Promise<DraftContent> {
    const attachments: Attachment[] = [];
    for (const kept of draft.attachments) {
      try {
        const res = await fetcher(`${DRAFT}/attachments/${encodeURIComponent(kept.id)}`, {});
        if (!res.ok) continue;
        const body = new Blob([await res.arrayBuffer()], { type: kept.mime });
        attachments.push({ id: `draft-${kept.id}`, name: kept.name, kind: kept.kind, body, size: kept.size, ...(kept.origin === undefined ? {} : { origin: kept.origin }), ...(kept.pasted ? { pasted: true } : {}) });
      } catch {
        // An attachment that cannot be read back is left out; the words still come.
      }
    }
    return { text: draft.text, attachments };
  }

  /** Gives the composer what the server holds. `server` says that the server holds exactly this (so that there is nothing to save). */
  async function take(draft: Draft, server: boolean): Promise<void> {
    const made = await contentOf(draft);
    for (const attachment of made.attachments) serverIds.set(attachment.id, attachment.id.slice('draft-'.length));
    local = made;
    base = Math.max(base, draft.revision);
    if (server) {
      saved = snapshotOf(made);
      present(true);
    }
    adopt(made);
  }

  const read = async (): Promise<Draft | null | undefined> => {
    try {
      const res = await fetcher(`${DRAFT}${key}`, {});
      return res.ok ? ((await res.json()) as DraftReply).draft : undefined;
    } catch {
      return undefined;
    }
  };

  const matches = (draft: Draft, content: DraftContent) => draft.text === content.text && draft.attachments.length === 0 && content.attachments.length === 0;
  const clean = () => (saved === undefined ? isEmpty(local) : sameSnapshot(saved, snapshotOf(local)));
  const savePending = () => {
    timers.clear(timer);
    timer = timers.set(() => {
      timer = undefined;
      enqueue(() => save());
    }, SAVE_PAUSE_MS);
  };

  return {
    store,
    async load(content) {
      local = content;
      const draft = await read();
      loaded = true;
      if (draft) {
        base = draft.revision;
        if (isEmpty(local)) {
          enqueue(() => take(draft, true));
        } else if (matches(draft, local)) {
          saved = snapshotOf(local);
          present(true);
        } else notify({ kind: 'elsewhere', how: 'found', theirs: draft });
      }
      enqueue(upload);
      if (!isEmpty(local) && !clean()) savePending();
      await chain;
    },
    change(content) {
      local = content;
      if (!loaded) return;
      enqueue(upload);
      if (isEmpty(content)) {
        timers.clear(timer);
        timer = undefined;
        enqueue(clear);
      } else savePending();
    },
    flush(hiding = false) {
      if (!loaded) return;
      timers.clear(timer);
      timer = undefined;
      enqueue(() => save(hiding));
    },
    async refresh(content) {
      local = content;
      if (!loaded) return;
      const draft = await read();
      if (!draft || draft.revision <= base) return;
      if (matches(draft, local)) {
        base = draft.revision;
        saved = snapshotOf(local);
      } else if (clean()) {
        notify({ kind: 'elsewhere', how: 'updated', theirs: draft });
        await take(draft, true);
      } else notify({ kind: 'elsewhere', how: 'newer', theirs: draft });
      await chain;
    },
    async takeTheirs() {
      const notice = store.state.notice;
      if (notice?.kind !== 'elsewhere') return;
      notify(undefined);
      // Our version is on the server after a `replaced` save, so theirs is saved over it in turn; otherwise theirs is what the server holds.
      await take(notice.theirs, notice.how !== 'replaced');
      if (notice.how === 'replaced') savePending();
    },
    keepMine() {
      const notice = store.state.notice;
      if (notice?.kind !== 'elsewhere') return;
      base = Math.max(base, notice.theirs.revision);
      notify(undefined);
      timers.clear(timer);
      timer = undefined;
      enqueue(() => save());
    },
    dismiss: () => notify(undefined),
    idle: async () => {
      await chain;
    },
    dispose() {
      if (loaded && timer !== undefined) {
        timers.clear(timer);
        timer = undefined;
        enqueue(() => save());
      }
    },
  };
}
