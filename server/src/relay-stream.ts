// A relay's view pushed to the browser as server-sent events (architecture §4 "Live relays"): the one stream every relayed page uses (the log tail, the
// worker log of a run). The event name is the update's `kind`. A stream ends when the owner's tab leaves, when the server ends it (the session ended,
// the server is stopping), or after an update that is the last of its view (a refusal, a finished run): what is queued is still delivered first.
import type { LogUpdate } from './log-relay.ts';

/** How often a quiet stream says it is alive: a proxy between Caduceus and the browser (Tailscale Serve) drops a connection that is silent for long. */
const HEARTBEAT_MS = 20_000;

export interface RelayStreams {
  /** The response that carries what `subscribe` hands to its listener, as the session `sessionId` watches it. `subscribe` returns how to stop watching. */
  respond(sessionId: string, subscribe: (listener: (update: LogUpdate) => void) => () => void): Response;
  /** Ends the streams of a session that ended. */
  closeSession(sessionId: string): void;
  /** Ends every stream: the server is stopping. */
  closeAll(): void;
}

export function createRelayStreams(): RelayStreams {
  const open = new Set<{ sessionId: string; close(): void }>();
  const encoder = new TextEncoder();
  return {
    respond(sessionId, subscribe) {
      // Whoever ends the stream (the owner's tab: `cancel`; the server: `close`; the view itself), what it holds is let go once.
      let live = true;
      let leave = () => {};
      let controller!: ReadableStreamDefaultController<Uint8Array>;
      const finish = () => {
        if (!live) return false;
        live = false;
        clearInterval(heartbeat);
        leave();
        open.delete(connection);
        return true;
      };
      // The response is a plain stream, not Hono's `streamSSE`: a write to a client that has just gone away must not hold the response open.
      const body = new ReadableStream<Uint8Array>({
        start(started) {
          controller = started;
        },
        cancel: () => void finish(),
      });
      const send = (event: string, data: unknown) => {
        if (live) controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      const heartbeat = setInterval(() => send('ping', {}), HEARTBEAT_MS);
      const connection = {
        sessionId,
        close() {
          // What is queued (a refusal) is still delivered before the stream ends.
          if (finish()) controller.close();
        },
      };
      open.add(connection);
      leave = subscribe((update) => {
        send(update.kind, update);
        if (update.kind === 'rejected' || update.kind === 'ended') connection.close();
      });
      // Told of an end at once (a view that has already ended or been refused): the stream ended before there was anything to let go.
      if (!live) leave();
      return new Response(body, { headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', 'x-accel-buffering': 'no', connection: 'close' } });
    },
    closeSession(sessionId) {
      for (const connection of open) if (connection.sessionId === sessionId) connection.close();
    },
    closeAll() {
      for (const connection of open) connection.close();
    },
  };
}
