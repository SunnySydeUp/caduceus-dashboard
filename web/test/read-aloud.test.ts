import { setImmediate as nextTurn } from 'node:timers/promises';
import { describe, expect, test } from 'vitest';
import { createReadAloud, type Playback } from '../src/modules/voice/read-aloud.ts';
import { speakable, speechParts } from '../src/modules/voice/speakable.ts';

// Reading a reply aloud (M7 #07): one reply plays at a time, playback can always be stopped, and what is spoken is the words, not the markup.
function setup() {
  const asked: { text: string; ready: PromiseWithResolvers<Blob> }[] = [];
  const played: { blob: Blob; ended: PromiseWithResolvers<void>; stopped: boolean }[] = [];
  const reader = createReadAloud({
    speak: (text) => {
      const ready = Promise.withResolvers<Blob>();
      asked.push({ text, ready });
      return ready.promise;
    },
    play: (blob): Playback => {
      const entry = { blob, ended: Promise.withResolvers<void>(), stopped: false };
      played.push(entry);
      return {
        ended: entry.ended.promise,
        stop: () => {
          entry.stopped = true;
          entry.ended.resolve();
        },
      };
    },
  });
  const blob = (name: string) => new Blob([name], { type: 'audio/mpeg' });
  return { reader, asked, played, blob };
}

describe('read aloud', () => {
  test('a reply is fetched as speech, then plays, then the reader is idle again', async () => {
    const { reader, asked, played, blob } = setup();
    const done = reader.toggle('m1', 'Hello there.');
    expect(reader.state()).toEqual({ phase: 'loading', key: 'm1' });
    asked[0]!.ready.resolve(blob('one'));
    await nextTurn();
    expect(reader.state()).toEqual({ phase: 'playing', key: 'm1' });
    played[0]!.ended.resolve();
    await done;
    expect(reader.state()).toEqual({ phase: 'idle' });
  });

  test('only one reply plays at a time: starting another stops the first', async () => {
    const { reader, asked, played, blob } = setup();
    const first = reader.toggle('m1', 'First.');
    asked[0]!.ready.resolve(blob('one'));
    await nextTurn();
    const second = reader.toggle('m2', 'Second.');
    expect(played[0]!.stopped).toBe(true);
    await first;
    expect(reader.state()).toEqual({ phase: 'loading', key: 'm2' });
    asked[1]!.ready.resolve(blob('two'));
    await nextTurn();
    expect(played).toHaveLength(2);
    expect(reader.state()).toEqual({ phase: 'playing', key: 'm2' });
    reader.stop();
    await second;
  });

  test('a reply that was still loading when another started never plays', async () => {
    const { reader, asked, played, blob } = setup();
    const first = reader.toggle('m1', 'First.');
    const second = reader.toggle('m2', 'Second.');
    asked[0]!.ready.resolve(blob('one'));
    await first;
    asked[1]!.ready.resolve(blob('two'));
    await nextTurn();
    expect(played.map((entry) => entry.blob)).toHaveLength(1);
    expect(reader.state()).toEqual({ phase: 'playing', key: 'm2' });
    reader.stop();
    await second;
  });

  test('the same reply again stops it, loading or playing', async () => {
    const { reader, asked } = setup();
    const done = reader.toggle('m1', 'Hello.');
    reader.toggle('m1', 'Hello.');
    await done;
    expect(reader.state()).toEqual({ phase: 'idle' });
    asked[0]!.ready.resolve(new Blob(['late']));
    await nextTurn();
    expect(reader.state()).toEqual({ phase: 'idle' });
  });

  test('a long reply goes in parts: the next is made while the last plays, and they play one after the other', async () => {
    const { reader, asked, played, blob } = setup();
    const done = reader.toggle('m1', ['Part one.', 'Part two.']);
    asked[0]!.ready.resolve(blob('one'));
    await nextTurn();
    expect(asked.map((entry) => entry.text)).toEqual(['Part one.', 'Part two.']);
    asked[1]!.ready.resolve(blob('two'));
    played[0]!.ended.resolve();
    await nextTurn();
    expect(played).toHaveLength(2);
    expect(reader.state()).toEqual({ phase: 'playing', key: 'm1' });
    played[1]!.ended.resolve();
    await done;
    expect(reader.state()).toEqual({ phase: 'idle' });
  });

  test('a failure leaves the reader idle and says why', async () => {
    const { reader, asked } = setup();
    const done = reader.toggle('m1', 'Hello.');
    asked[0]!.ready.reject(new Error('Hermes could not speak that'));
    await done;
    expect(reader.state()).toEqual({ phase: 'idle', error: 'Hermes could not speak that' });
  });

  test('subscribers hear every change', async () => {
    const { reader, asked, played, blob } = setup();
    const seen: string[] = [];
    reader.subscribe(() => seen.push(reader.state().phase));
    const done = reader.toggle('m1', 'Hello.');
    asked[0]!.ready.resolve(blob('one'));
    await nextTurn();
    played[0]!.ended.resolve();
    await done;
    expect(seen).toEqual(['loading', 'playing', 'idle']);
  });
});

describe('what is spoken', () => {
  test('markup becomes words', () => {
    expect(speakable('## Result\n\nThe **fast** one is [here](https://example.com/x), see `npm test`.')).toBe('Result. The fast one is here, see npm test.');
  });

  test('a code block is mentioned, not read out', () => {
    expect(speakable('Run this:\n\n```sh\nrm -rf node_modules\nnpm install\n```\n\nThen wait.')).toBe('Run this: Code block omitted. Then wait.');
  });

  test('lists and quotes keep their words, tables are left out, and bare links are not spelled', () => {
    expect(speakable('- one\n- two\n\n> quoted\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nSee https://example.com/very/long/path today')).toBe('one. two. quoted. Table omitted. See link today');
  });

  test('long text goes in parts that break at sentences', () => {
    const sentence = 'This is one sentence of the reply. ';
    const parts = speechParts(sentence.repeat(300), 1000);
    expect(parts.length).toBeGreaterThan(5);
    for (const part of parts) {
      expect(part.length).toBeLessThanOrEqual(1000);
      expect(part.endsWith('.')).toBe(true);
    }
    expect(parts.join(' ')).toBe(sentence.repeat(300).trim());
  });
});
