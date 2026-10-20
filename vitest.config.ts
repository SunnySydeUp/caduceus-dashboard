import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['server/test/**/*.test.ts', 'web/test/**/*.test.ts'],
    // Each run has a temp directory of its own, and fails when a test leaves one of its directories in it (see the file).
    globalSetup: ['./server/test/fixtures/run-temp-root.ts'],
    // Vitest runs one test file per worker, `cpus - 1` workers at a time (9 here), and over half of the files start their own real `hermes serve`
    // (a Python process that is CPU-bound for seconds) and run `hermes` CLIs beside it. Nine of them at once, on a machine that is shared with
    // other runs, starve each other until a test's 15 s runs out; five finish the suite in the same time (measured: ~3 min under heavy load, with
    // and without the cap) and each Hermes gets a fair share of the CPU. The files that need no Hermes are quick and lose nothing.
    maxWorkers: 5,
    testTimeout: 15_000,
    // Starting or stopping a real `hermes serve` is waiting for the operating system to run a Python process: it takes seconds on a quiet
    // machine and half a minute on a busy one. The hooks that do it (and the cleanup that follows it, which must not be skipped by a hook
    // that timed out) get that time; a test's own 15 s is for what it asserts, and its waits are on events.
    hookTimeout: 60_000,
    // Vitest turns every CSS import into an empty string; tests that check code against the design tokens read the real file.
    css: { include: [/design\/tokens\.css/] },
  },
});
