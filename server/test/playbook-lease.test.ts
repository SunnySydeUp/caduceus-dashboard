import { afterEach, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLease } from '../src/playbook-lease.ts';

// The single-writer lease of the playbook engine (M6 #02; architecture §1): a file in the Caduceus folder that at most one engine holds. A second
// engine stays passive while it is held and takes over after it has not been renewed for the lease's time.
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-lease-'));
  dirs.push(dir);
  const clock = { now: 1_000_000 };
  const make = (owner: string) => createLease({ file: path.join(dir, 'engine.lease'), owner, ttlMs: 30_000, now: () => clock.now });
  return { clock, make, dir };
}

describe('the engine lease', () => {
  test('the first to ask holds it, a second stays passive while it is held, and takes over only after it has expired', () => {
    const { clock, make } = setup();
    const a = make('engine-a');
    const b = make('engine-b');
    expect(a.acquire()).toBe(true);
    expect(b.acquire()).toBe(false);
    clock.now += 29_999;
    expect(b.acquire()).toBe(false);
    clock.now += 2;
    expect(b.acquire()).toBe(true);
    // The first no longer holds it, and cannot take it back while the second keeps it.
    expect(a.acquire()).toBe(false);
    expect(a.held()).toBe(false);
    expect(b.held()).toBe(true);
  });

  test('the holder renews it by asking again, which keeps a second engine out for another full time', () => {
    const { clock, make } = setup();
    const a = make('engine-a');
    const b = make('engine-b');
    a.acquire();
    clock.now += 20_000;
    expect(a.acquire()).toBe(true);
    clock.now += 20_000;
    expect(b.acquire()).toBe(false);
    clock.now += 11_000;
    expect(b.acquire()).toBe(true);
  });

  test('releasing it lets another take it at once, and releasing one that is not held changes nothing', () => {
    const { make } = setup();
    const a = make('engine-a');
    const b = make('engine-b');
    a.acquire();
    b.release();
    expect(a.held()).toBe(true);
    a.release();
    expect(b.acquire()).toBe(true);
  });

  test('a lease file nobody can read (damaged) is taken over, not obeyed', () => {
    const { make, dir } = setup();
    fs.writeFileSync(path.join(dir, 'engine.lease'), 'not json');
    expect(make('engine-a').acquire()).toBe(true);
  });
});
