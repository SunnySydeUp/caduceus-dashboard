import { setImmediate as nextTurn } from 'node:timers/promises';
import { describe, expect, test } from 'vitest';
import { createLogRelay, newLines, type LogAnswer, type LogRead, type LogUpdate } from '../src/log-relay.ts';

// The log relay (M5 #06, architecture §4 "Live relays"): Hermes's log endpoint can only be asked for the last lines, so Caduceus asks
// it once for everyone who watches the same view and tells each of them what is new. The relay is a pure module: what it asks Hermes
// (`read`) and the clock (`timers`) are handed to it, so a test winds the clock by hand and answers each ask itself.

/** A clock wound by hand: `fire()` runs the timer that is waiting, if there is one. */
function handClock() {
  let waiting: { run: () => void; ms: number } | undefined;
  return {
    timers: {
      set(run: () => void, ms: number) {
        const timer = { run, ms };
        waiting = timer;
        return timer;
      },
      clear(timer: unknown) {
        if (waiting === timer) waiting = undefined;
      },
    },
    get waiting() {
      return waiting !== undefined;
    },
    get delay() {
      return waiting?.ms;
    },
    async fire() {
      const timer = waiting;
      waiting = undefined;
      timer?.run();
      // The poll that the timer started is an async function: let it finish its answer.
      await nextTurn();
    },
  };
}

const QUERY = { file: 'agent', lines: 100 };

/** A Hermes whose log is `log` (changeable), counting how often it was asked. */
function hermesWith(log: string[]) {
  const asked: unknown[] = [];
  const read: LogRead = async (query) => {
    asked.push(query);
    return { ok: true, lines: [...log] };
  };
  return { log, asked, read };
}

describe('the relay asks Hermes once for everyone watching a view', () => {
  test('a second client on the same view is not another ask, and every client is told what is new', async () => {
    const hermes = hermesWith(['a', 'b']);
    const clock = handClock();
    const relay = createLogRelay({ read: hermes.read, intervalMs: 1500, timers: clock.timers });
    const first: LogUpdate[] = [];
    const second: LogUpdate[] = [];

    relay.subscribe(QUERY, (update) => first.push(update));
    await nextTurn();
    relay.subscribe(QUERY, (update) => second.push(update));
    hermes.log.push('c');
    await clock.fire();

    expect(hermes.asked).toHaveLength(2);
    expect(first).toEqual([{ kind: 'replace', lines: ['a', 'b'] }, { kind: 'append', lines: ['c'] }]);
    // A client that joins later is given the view as it is, then what comes next.
    expect(second).toEqual([{ kind: 'replace', lines: ['a', 'b'] }, { kind: 'append', lines: ['c'] }]);
    expect(clock.delay).toBe(1500);
  });
});

describe('what is new in the last lines Hermes gave', () => {
  test('is what follows the longest run of lines the reader already has', () => {
    expect(newLines(['a', 'b', 'c'], ['b', 'c', 'd', 'e'])).toEqual({ kind: 'append', lines: ['d', 'e'] });
    expect(newLines(['a', 'a'], ['a', 'a', 'a'])).toEqual({ kind: 'append', lines: ['a'] });
    expect(newLines(['a', 'b'], ['a', 'b'])).toBeUndefined();
    expect(newLines([], ['a'])).toEqual({ kind: 'append', lines: ['a'] });
  });

  test('is the whole answer when it shares nothing with what the reader has (the log was cleared, rotated, or ran on past the window)', () => {
    expect(newLines(['a', 'b'], ['x', 'y'])).toEqual({ kind: 'replace', lines: ['x', 'y'] });
    expect(newLines(['a', 'b'], [])).toEqual({ kind: 'replace', lines: [] });
    // Fewer lines that are the end of what was there: the front was cut off, nothing was added.
    expect(newLines(['a', 'b', 'c'], ['c'])).toEqual({ kind: 'replace', lines: ['c'] });
  });
});

describe('the relay stops asking when the last client leaves', () => {
  test('no timer is left waiting, an answer still on its way is dropped, and a client that comes back starts a new ask', async () => {
    const hermes = hermesWith(['a']);
    const clock = handClock();
    const relay = createLogRelay({ read: hermes.read, intervalMs: 1500, timers: clock.timers });
    const heard: LogUpdate[] = [];
    const first = relay.subscribe(QUERY, (update) => heard.push(update));
    const second = relay.subscribe(QUERY, (update) => heard.push(update));
    await nextTurn();

    first();
    expect(clock.waiting).toBe(true);
    second();
    expect(clock.waiting).toBe(false);
    hermes.log.push('b');
    await clock.fire();
    expect(hermes.asked).toHaveLength(1);

    relay.subscribe(QUERY, (update) => heard.push(update));
    await nextTurn();
    expect(hermes.asked).toHaveLength(2);
    expect(heard.at(-1)).toEqual({ kind: 'replace', lines: ['a', 'b'] });
  });

  test('another view is its own ask: the same file with another level is not shared', async () => {
    const hermes = hermesWith(['a']);
    const relay = createLogRelay({ read: hermes.read, intervalMs: 1500, timers: handClock().timers });

    relay.subscribe(QUERY, () => undefined);
    relay.subscribe({ ...QUERY, level: 'ERROR' }, () => undefined);
    await nextTurn();

    expect(hermes.asked).toEqual([QUERY, { ...QUERY, level: 'ERROR' }]);
  });
});

describe('when Hermes cannot be read', () => {
  test('watchers are told once, and given the view whole when Hermes answers again', async () => {
    let answer: LogAnswer = { ok: true, lines: ['a'] };
    const clock = handClock();
    const relay = createLogRelay({ read: async () => answer, intervalMs: 1500, timers: clock.timers });
    const heard: LogUpdate[] = [];
    relay.subscribe(QUERY, (update) => heard.push(update));
    await nextTurn();

    answer = { ok: false, rejected: false, message: 'Hermes is restarting' };
    await clock.fire();
    await clock.fire();
    answer = { ok: true, lines: ['a', 'b'] };
    await clock.fire();

    expect(heard).toEqual([{ kind: 'replace', lines: ['a'] }, { kind: 'unavailable', message: 'Hermes is restarting' }, { kind: 'replace', lines: ['a', 'b'] }]);
  });

  test('a refusal that asking again will not change ends the asking, and is told to a client that joins later too', async () => {
    const clock = handClock();
    const relay = createLogRelay({ read: async () => ({ ok: false, rejected: true, message: 'Unknown component: nope' }), intervalMs: 1500, timers: clock.timers });
    const first: LogUpdate[] = [];
    const late: LogUpdate[] = [];
    relay.subscribe(QUERY, (update) => first.push(update));
    await nextTurn();
    relay.subscribe(QUERY, (update) => late.push(update));

    expect(clock.waiting).toBe(false);
    expect(first).toEqual([{ kind: 'rejected', message: 'Unknown component: nope' }]);
    expect(late).toEqual(first);
  });
});

describe('a view that has an end', () => {
  test('an answer that says the source is finished is the last: clients hear what it adds and then `ended`, no timer is left, and a client that joins later is given the view whole and `ended`', async () => {
    let answer: LogAnswer = { ok: true, lines: ['a'] };
    const asked: number[] = [];
    const clock = handClock();
    const relay = createLogRelay({ read: async () => (asked.push(1), answer), intervalMs: 1500, timers: clock.timers });
    const heard: LogUpdate[] = [];
    relay.subscribe(QUERY, (update) => heard.push(update));
    await nextTurn();

    answer = { ok: true, lines: ['a', 'b'], done: true };
    await clock.fire();
    expect(heard).toEqual([{ kind: 'replace', lines: ['a'] }, { kind: 'append', lines: ['b'] }, { kind: 'ended' }]);
    expect(clock.waiting).toBe(false);

    const late: LogUpdate[] = [];
    relay.subscribe(QUERY, (update) => late.push(update));
    expect(late).toEqual([{ kind: 'replace', lines: ['a', 'b'] }, { kind: 'ended' }]);
    expect(asked).toHaveLength(2);
  });
});
