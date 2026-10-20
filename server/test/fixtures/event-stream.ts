// A server-sent event stream as a browser's `EventSource` reads it: opened with the owner's cookie, read event by event. Heartbeat
// comments (`: ping`) are not events and are skipped, as `EventSource` skips them.

export interface ServerEvent {
  event: string;
  data: unknown;
}

export interface EventStream {
  status: number;
  headers: Headers;
  /** The next event; rejects when the stream ends first. */
  next(): Promise<ServerEvent>;
  /** Ends the connection from this side, as a closed tab does. */
  close(): void;
}

/** Opens `route` on the server at `url` and returns once the response head has arrived. */
export async function openEventStream(url: string, route: string, cookie: string): Promise<EventStream> {
  const controller = new AbortController();
  const res = await fetch(`${url}${route}`, { headers: { origin: url, cookie, accept: 'text/event-stream' }, signal: controller.signal });
  const reader = res.body?.getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  return {
    status: res.status,
    headers: res.headers,
    async next() {
      for (;;) {
        const end = buffered.indexOf('\n\n');
        if (end >= 0) {
          const block = buffered.slice(0, end);
          buffered = buffered.slice(end + 2);
          const lines = block.split('\n').filter((line) => !line.startsWith(':'));
          const event = lines.find((line) => line.startsWith('event:'))?.slice(6).trim();
          if (event === undefined || event === 'ping') continue;
          const data = lines.filter((line) => line.startsWith('data:')).map((line) => line.slice(5).replace(/^ /, '')).join('\n');
          return { event, data: data === '' ? undefined : JSON.parse(data) };
        }
        const chunk = await reader?.read();
        if (!chunk || chunk.done) throw new Error('The event stream ended.');
        buffered += decoder.decode(chunk.value, { stream: true });
      }
    },
    close: () => controller.abort(),
  };
}
