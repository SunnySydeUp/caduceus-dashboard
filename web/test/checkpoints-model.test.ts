import { describe, expect, test } from 'vitest';
import { diffFiles } from '../src/modules/git/git-model.ts';
import { DIFF_LIMIT, diffCut, parseCheckpoints, parseStorage, plainDiff, sizeWords } from '../src/modules/checkpoints/checkpoints-model.ts';

describe('the checkpoints Hermes lists', () => {
  test('keep their hash, time and message in the order Hermes gave (newest first), and say whether checkpoints are on', () => {
    const listed = parseCheckpoints({
      enabled: true,
      checkpoints: [
        { hash: 'bbbbbbbbbbbbbbbb', timestamp: '2026-10-19T03:02:52+10:00', message: 'before edit' },
        { hash: 'aaaaaaaaaaaaaaaa', timestamp: 'not a time', message: '' },
        { nope: 1 },
      ],
    });
    expect(listed.enabled).toBe(true);
    expect(listed.items).toEqual([
      { hash: 'bbbbbbbbbbbbbbbb', short: 'bbbbbbb', at: Date.parse('2026-10-19T03:02:52+10:00'), message: 'before edit' },
      { hash: 'aaaaaaaaaaaaaaaa', short: 'aaaaaaa', at: undefined, message: undefined },
    ]);
    expect(parseCheckpoints({ enabled: false, checkpoints: [] })).toEqual({ enabled: false, items: [] });
    expect(parseCheckpoints('nope')).toEqual({ enabled: false, items: [] });
  });

  test('the store’s size is Hermes’s total in bytes, in words', () => {
    expect(parseStorage({ sessions: [], total_bytes: 5_242_880 })).toEqual({ totalBytes: 5_242_880 });
    expect(parseStorage({})).toBeUndefined();
    expect(sizeWords(0)).toBe('0 B');
    expect(sizeWords(2048)).toBe('2.0 KB');
    expect(sizeWords(5_242_880)).toBe('5.0 MB');
  });
});

describe('a checkpoint’s diff', () => {
  test('is Hermes’s plain unified diff with any terminal escape taken out, and still only text for the diff view (never markup)', () => {
    const hostile = 'diff --git a/a.html b/a.html\n--- a/a.html\n+++ b/a.html\n@@ -1 +1 @@\n-<b>old</b>\n+\u001b[31m<script>alert(1)</script>\u001b[0m\n';
    const clean = plainDiff(hostile);
    expect(clean).not.toContain('\u001b');
    const [file] = diffFiles(clean);
    expect(file.rows.at(-1)).toMatchObject({ kind: 'add', text: '<script>alert(1)</script>' });
  });

  test('is cut by Hermes at 4000 characters, and the page says so', () => {
    expect(DIFF_LIMIT).toBe(4000);
    expect(diffCut('x'.repeat(3999))).toBe(false);
    expect(diffCut('x'.repeat(4000))).toBe(true);
  });
});
