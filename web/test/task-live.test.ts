import { afterEach, describe, expect, test, vi } from 'vitest';
import { createLiveTask, type LiveTask, type LiveTaskState } from '../src/modules/work/task-live.ts';

// The open task page against a stub of Hermes: a task that changes and an events stream the test writes to by hand.
class StubSocket extends EventTarget {
  readyState = 0;
  readonly url: string;
  constructor(url: string) {
    super();
    this.url = url;
  }
  open() {
    this.readyState = 1;
    this.dispatchEvent(new Event('open'));
  }
  send(frame: unknown) {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(frame) }));
  }
  close() {
    this.readyState = 3;
    this.dispatchEvent(new Event('close'));
  }
}

const hermesTask = (status: string, events: { id: number; kind: string }[]) => ({
  task: { id: 't_1', title: 'Ship it', status },
  events: events.map((event) => ({ ...event, task_id: 't_1', payload: null, created_at: 1, run_id: null })),
});

const engines: LiveTask[] = [];
afterEach(() => engines.splice(0).forEach((engine) => engine.close()));

function setup() {
  let current = hermesTask('ready', [{ id: 10, kind: 'created' }]);
  const reads = { count: 0 };
  const sockets: StubSocket[] = [];
  const engine = createLiveTask({
    fetchTask: async () => {
      reads.count++;
      return current;
    },
    openEvents: async (since) => {
      const socket = new StubSocket(`since=${since}`);
      sockets.push(socket);
      return socket as unknown as WebSocket;
    },
    coalesceMs: 0,
    backoff: { baseDelayMs: 1, capMs: 2 },
  });
  engines.push(engine);
  const until = (match: (state: LiveTaskState) => boolean) => {
    if (match(engine.state)) return Promise.resolve(engine.state);
    const { promise, resolve } = Promise.withResolvers<LiveTaskState>();
    const stop = engine.subscribe(() => {
      if (!match(engine.state)) return;
      stop();
      resolve(engine.state);
    });
    return promise;
  };
  return { engine, sockets, until, reads, set: (next: typeof current) => (current = next) };
}

describe('the live task', () => {
  test('loads the task, then follows it: an event of this task makes the page read it again', async () => {
    const { sockets, until, set } = setup();
    const first = await until((state) => state.phase === 'ready');
    expect(first.detail?.task.status).toBe('ready');
    await until(() => sockets.length === 1);
    expect(sockets[0].url).toBe('since=10');
    sockets[0].open();
    await until((state) => state.live);

    set(hermesTask('running', [{ id: 10, kind: 'created' }, { id: 11, kind: 'status' }]));
    sockets[0].send({ events: [{ id: 11, task_id: 't_1', kind: 'status' }], cursor: 11 });
    const next = await until((state) => state.detail?.task.status === 'running');
    expect(next.phase).toBe('ready');
  });

  test('an event of another task changes nothing', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const { sockets, until, reads } = setup();
      await until((state) => state.phase === 'ready');
      await until(() => sockets.length === 1);
      sockets[0].open();
      await until((state) => state.live);
      expect(reads.count).toBe(1);
      sockets[0].send({ events: [{ id: 12, task_id: 't_other', kind: 'status' }], cursor: 12 });
      await vi.advanceTimersByTimeAsync(1000);
      expect(reads.count).toBe(1);
      sockets[0].send({ events: [{ id: 13, task_id: 't_1', kind: 'edited' }], cursor: 13 });
      await vi.advanceTimersByTimeAsync(1000);
      expect(reads.count).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  test('a write announced by Caduceus reads the task again, since Hermes records no event for a delete', async () => {
    const { sockets, until, set } = setup();
    await until((state) => state.phase === 'ready');
    await until(() => sockets.length === 1);
    sockets[0].open();
    await until((state) => state.live);
    set(hermesTask('blocked', [{ id: 10, kind: 'created' }]));
    sockets[0].send({ written: true });
    await until((state) => state.detail?.task.status === 'blocked');
  });

  test('a task Hermes no longer has is a failure the page can show', async () => {
    const { until, engine } = setup();
    await until((state) => state.phase === 'ready');
    engine.close();
    const failing = createLiveTask({
      fetchTask: async () => {
        throw new Error('Hermes answered HTTP 404');
      },
      openEvents: async () => new StubSocket('x') as unknown as WebSocket,
      backoff: { baseDelayMs: 1, capMs: 2 },
    });
    engines.push(failing);
    const failed = Promise.withResolvers<LiveTaskState>();
    failing.subscribe(() => failing.state.phase === 'failed' && failed.resolve(failing.state));
    const state = await failed.promise;
    expect(state).toMatchObject({ phase: 'failed', error: 'Hermes answered HTTP 404' });
  });
});
