import { describe, expect, test } from 'vitest';
import { BlockAsks } from '../src/block-asks.ts';

// Which answer a block shows when it asks more than once. A block asks at once and again when Hermes comes up (`use-block.ts`): the first answer is what the screen
// waits for, so it must not be thrown away only because a second ask went out behind it. Pure: no clock, no fetch.
describe('BlockAsks', () => {
  test('the first answer shows while a second ask is still out, and the second answer then replaces it', () => {
    const asks = new BlockAsks();
    const first = asks.ask();
    const second = asks.ask();
    expect(asks.accepts(first, false)).toBe(true);
    expect(asks.accepts(second, false)).toBe(true);
  });

  test('an older answer that arrives after a newer one is dropped', () => {
    const asks = new BlockAsks();
    const first = asks.ask();
    const second = asks.ask();
    expect(asks.accepts(second, false)).toBe(true);
    expect(asks.accepts(first, false)).toBe(false);
    expect(asks.accepts(first, true)).toBe(false);
  });

  test('a failure of an older ask is not shown while a newer ask is out, and is when it was the latest', () => {
    const asks = new BlockAsks();
    const first = asks.ask();
    const second = asks.ask();
    expect(asks.accepts(first, true)).toBe(false);
    expect(asks.accepts(second, true)).toBe(true);
  });

  test('a failure of the latest ask shows even after an older answer was shown', () => {
    const asks = new BlockAsks();
    const first = asks.ask();
    const second = asks.ask();
    expect(asks.accepts(first, false)).toBe(true);
    expect(asks.accepts(second, true)).toBe(true);
  });

  test('answers still out when the scope changes (another profile, Hermes not ready) are dropped, and later asks are taken', () => {
    const asks = new BlockAsks();
    const before = asks.ask();
    asks.drop();
    expect(asks.accepts(before, false)).toBe(false);
    const after = asks.ask();
    expect(asks.accepts(after, false)).toBe(true);
  });
});
