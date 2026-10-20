// How the page holds server-sent streams. Over plain HTTP/1.1 (Caduceus on `http://localhost:9130`) a browser allows six connections per host across all
// its tabs, and a stream holds one for as long as it is open, so about six tabs would leave every further request waiting. Two rules keep that from
// happening: a tab nobody is looking at holds no stream, and readers of one address in one tab share one stream.
//
// What a hidden tab misses is not lost. Every stream Caduceus offers says its whole view when a connection opens (the Inbox its whole list, a log its
// whole text as `replace`, an operation every line from the start), so opening the stream again on return is the catch-up; `onResume` is for a reader
// that also wants to read something the stream does not carry.

/** Whether the page is in view, and when that changes. */
export interface PageVisibility {
  visible(): boolean;
  subscribe(listener: () => void): () => void;
}

/** The part of `EventSource` the hub uses, so a test can stand in for the browser's. */
export interface StreamSource {
  readyState: number;
  onopen: ((event?: unknown) => void) | null;
  onerror: ((event?: unknown) => void) | null;
  addEventListener(type: string, listener: (event: { data: string }) => void): void;
  close(): void;
}

export interface StreamListener {
  /** The event names to hear. */
  events: readonly string[];
  onEvent(type: string, data: string): void;
  /** A connection opened (the first, or one the browser made again after a drop). */
  onOpen?(): void;
  /** A connection broke. `closed`: the browser has given up on it (Caduceus answered with an error, such as being signed out) rather than reconnecting. */
  onError?(closed: boolean): void;
  /** The page was seen again and the stream was opened afresh. */
  onResume?(): void;
}

export interface StreamHub {
  /** Listens to the stream at `url`; the returned function stops, and the stream is closed when its last reader has stopped. */
  subscribe(url: string, listener: StreamListener): () => void;
}

/** `EventSource.CLOSED`, which a test environment does not have. */
const CLOSED = 2;

export const pageVisibility: PageVisibility = {
  visible: () => document.visibilityState === 'visible',
  subscribe: (listener) => {
    document.addEventListener('visibilitychange', listener);
    return () => document.removeEventListener('visibilitychange', listener);
  },
};

interface Entry {
  readers: Set<StreamListener>;
  source: StreamSource | undefined;
}

export function createStreamHub(open: (url: string) => StreamSource, visibility: PageVisibility): StreamHub {
  const entries = new Map<string, Entry>();
  let unwatch: (() => void) | undefined;

  const connect = (url: string, entry: Entry) => {
    const source = open(url);
    entry.source = source;
    source.onopen = () => {
      for (const reader of [...entry.readers]) reader.onOpen?.();
    };
    source.onerror = () => {
      const closed = source.readyState === CLOSED;
      for (const reader of [...entry.readers]) reader.onError?.(closed);
    };
    const types = new Set([...entry.readers].flatMap((reader) => reader.events));
    for (const type of types) {
      source.addEventListener(type, (event) => {
        for (const reader of [...entry.readers]) if (reader.events.includes(type)) reader.onEvent(type, event.data);
      });
    }
  };

  const disconnect = (entry: Entry) => {
    entry.source?.close();
    entry.source = undefined;
  };

  const onVisibility = () => {
    for (const [url, entry] of entries) {
      if (!visibility.visible()) disconnect(entry);
      else if (!entry.source) {
        connect(url, entry);
        for (const reader of [...entry.readers]) reader.onResume?.();
      }
    }
  };

  return {
    subscribe(url, listener) {
      let entry = entries.get(url);
      if (!entry) {
        entry = { readers: new Set(), source: undefined };
        entries.set(url, entry);
        unwatch ??= visibility.subscribe(onVisibility);
      }
      entry.readers.add(listener);
      if (visibility.visible()) {
        // A connection already made has said its view before this reader came; a new one says it again, to every reader.
        disconnect(entry);
        connect(url, entry);
      }
      const owned = entry;
      return () => {
        // A reader that stopped already must not close the stream of a later reader of the same address.
        if (!owned.readers.delete(listener) || owned.readers.size > 0) return;
        disconnect(owned);
        entries.delete(url);
        if (entries.size === 0) {
          unwatch?.();
          unwatch = undefined;
        }
      };
    },
  };
}

let shared: StreamHub | undefined;

/** The page's hub, over the real `EventSource`. */
export function streamHub(): StreamHub {
  shared ??= createStreamHub((url) => new EventSource(url) as unknown as StreamSource, pageVisibility);
  return shared;
}
