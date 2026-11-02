import { describe, expect, it, vi } from 'vitest';
import { titleList, todayVoice, VoiceStore, type BlockReport } from '../src/modules/today/today-voice.ts';

const failed = (title: string, cause: string, retry = () => {}): BlockReport => ({ title, kind: 'failed', cause, retry });

describe('Today’s one voice for its blocks', () => {
  it('says once, for several blocks, a cause they failed with, and its Retry asks each of them again', () => {
    const [ready, day] = [vi.fn(), vi.fn()];
    const voice = todayVoice([
      ['ready', failed('Ready for review', 'Hermes isn’t answering', ready)],
      ['day', failed('Today’s schedule', 'Hermes isn’t answering', day)],
      ['reminders', failed('Reminders', 'remindctl failed')],
    ]);
    expect(voice.lines).toMatchObject([{ kind: 'failed', cause: 'Hermes isn’t answering', titles: ['Ready for review', 'Today’s schedule'] }]);
    expect([...voice.spokenFor]).toEqual(['ready', 'day']);
    const [line] = voice.lines;
    if (line?.kind === 'failed') line.retry();
    expect([ready.mock.calls.length, day.mock.calls.length]).toEqual([1, 1]);
  });

  it('leaves one block alone to say its own failure or slowness', () => {
    expect(todayVoice([['ready', failed('Ready for review', 'Hermes isn’t answering')]]).lines).toEqual([]);
    expect(todayVoice([['day', { title: 'Today’s schedule', kind: 'slow' }]]).lines).toEqual([]);
  });

  it('says once that several blocks are still being read', () => {
    const voice = todayVoice([
      ['need', { title: 'Needs you', kind: 'slow' }],
      ['ready', { title: 'Ready for review', kind: 'slow' }],
    ]);
    expect(voice.lines).toEqual([{ kind: 'slow', titles: ['Needs you', 'Ready for review'] }]);
  });

  it('offline, lists every block with nothing loaded, even one, so that "not loaded" is said one way', () => {
    const voice = todayVoice([['reminders', { title: 'Reminders', kind: 'unloaded' }]]);
    expect(voice.lines).toEqual([{ kind: 'unloaded', titles: ['Reminders'] }]);
    expect(voice.spokenFor.has('reminders')).toBe(true);
  });

  it('keeps the page’s order whatever order the blocks reported in, and says nothing new for the same report', () => {
    const store = new VoiceStore(['need', 'ready', 'day']);
    const heard = vi.fn();
    store.subscribe(heard);
    store.report('day', { title: 'Today’s schedule', kind: 'unloaded' });
    store.report('need', { title: 'Needs you', kind: 'unloaded' });
    store.report('need', { title: 'Needs you', kind: 'unloaded' });
    expect(store.get().lines).toEqual([{ kind: 'unloaded', titles: ['Needs you', 'Today’s schedule'] }]);
    expect(heard).toHaveBeenCalledTimes(2);
    store.report('need', undefined);
    store.report('day', undefined);
    expect(store.get().lines).toEqual([]);
  });

  it('lists titles in words', () => {
    expect([titleList(['A']), titleList(['A', 'B']), titleList(['A', 'B', 'C'])]).toEqual(['A', 'A and B', 'A, B and C']);
  });
});
