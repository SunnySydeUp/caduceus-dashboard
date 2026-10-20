import { describe, expect, test } from 'vitest';
import { LARGE_PASTE_CHARS, MAX_ATTACHMENTS, admit, collapsePaste, describeProblems, keepInline, sizeText, type Attachment } from '../src/modules/chat/attachments.ts';

// What the composer attaches to a message (M1 #10), free of the DOM: what counts as an image, a PDF or a file, how many may go, how large each may be.
const file = (name: string, size = 10, type = '') => ({ name, body: new Blob([new Uint8Array(size)], { type }) });
const names = (attachments: readonly Attachment[]) => attachments.map((attachment) => attachment.name);

describe('what may be attached', () => {
  test('at most 20 attachments go with a message: the first that fit are kept, and the rest are refused with the reason', () => {
    const first = admit([], Array.from({ length: 18 }, (_, index) => file(`a${index}.txt`)));
    expect(first.attachments).toHaveLength(18);
    expect(first.problems).toEqual([]);

    const more = admit(first.attachments, [file('b1.txt'), file('b2.txt'), file('b3.txt')]);
    expect(more.attachments).toHaveLength(MAX_ATTACHMENTS);
    expect(names(more.attachments).slice(-2)).toEqual(['b1.txt', 'b2.txt']);
    expect(more.problems).toEqual([{ name: 'b3.txt', reason: 'A message takes at most 20 attachments.' }]);
  });
});

describe('what each thing is and how large it may be', () => {
  test('images Hermes can read are images, PDFs are PDFs, and everything else (an SVG, a HEIC photo, source code) is a file', () => {
    const { attachments } = admit([], [file('a.PNG'), file('b.jpeg'), file('c.webp'), file('d.pdf'), file('e.svg', 10, 'image/svg+xml'), file('f.heic', 10, 'image/heic'), file('g.ts'), file('h', 10, 'image/png'), file('i', 10, 'application/pdf'), file('j')]);
    expect(attachments.map(({ name, kind }) => `${name}:${kind}`)).toEqual(['a.PNG:image', 'b.jpeg:image', 'c.webp:image', 'd.pdf:pdf', 'e.svg:file', 'f.heic:file', 'g.ts:file', 'h:image', 'i:pdf', 'j:file']);
  });

  test('an empty file and one over its cap are refused by name, each with its reason, and the others still go', () => {
    const { attachments, problems } = admit([], [file('empty.txt', 0), file('big.png', 25 * 1024 * 1024 + 1), file('fine.png', 25 * 1024 * 1024), file('big.pdf', 50 * 1024 * 1024 + 1), file('big.zip.txt', 50 * 1024 * 1024 + 1), file('ok.txt')]);
    expect(names(attachments)).toEqual(['fine.png', 'ok.txt']);
    expect(problems).toEqual([
      { name: 'empty.txt', reason: 'It is empty.' },
      { name: 'big.png', reason: 'An image may be at most 25 MB; this one is 25.0 MB.' },
      { name: 'big.pdf', reason: 'A PDF may be at most 50 MB; this one is 50.0 MB.' },
      { name: 'big.zip.txt', reason: 'A file may be at most 50 MB; this one is 50.0 MB.' },
    ]);
  });
});

describe('a large paste', () => {
  const text = (length: number) => 'x'.repeat(length);

  test('text above the threshold is held back as a Markdown file; text at it stays a paste', () => {
    expect(collapsePaste(text(LARGE_PASTE_CHARS), [])).toBeUndefined();
    const collapsed = collapsePaste(text(LARGE_PASTE_CHARS + 1), [])!;
    expect(collapsed.name).toBe('pasted-text-1.md');
    expect(collapsed.body.type).toBe('text/markdown');
    expect(collapsed.body.size).toBe(LARGE_PASTE_CHARS + 1);
  });

  test('a paste numbers on from the pastes already attached, and the owner can put the text back inline: it leaves the attachments and goes in at the caret', async () => {
    const first = admit([], [collapsePaste(text(5000), [])!]);
        expect(collapsePaste(text(5000), first.attachments)!.name).toBe('pasted-text-2.md');
    expect(first.attachments[0]).toMatchObject({ name: 'pasted-text-1.md', pasted: true, kind: 'file' });

    // A name is never used twice: the number goes on from the highest, even when an earlier paste has gone back inline.
    const both = admit(first.attachments, [collapsePaste(text(5000), first.attachments)!]).attachments;
    expect(collapsePaste(text(5000), both.slice(1))!.name).toBe('pasted-text-3.md');

    const kept = await keepInline('Look: ', 6, first.attachments, first.attachments[0]!.id);
    expect(kept.attachments).toEqual([]);
    expect(kept.text).toBe(`Look: ${text(5000)}`);
    expect(kept.caret).toBe(6 + 5000);
    expect((await keepInline('ab', 1, first.attachments, first.attachments[0]!.id)).text).toBe(`a${text(5000)}b`);
  });
});

describe('telling the owner what was left out', () => {
  test('things refused for the same reason are one line: the first names, then how many more', () => {
    expect(describeProblems([])).toEqual([]);
    expect(describeProblems([{ name: 'a.txt', reason: 'It is empty.' }])).toEqual(['a.txt: It is empty.']);
    const crowded = ['a', 'b', 'c', 'd', 'e'].map((name) => ({ name: `${name}.txt`, reason: 'A message takes at most 20 attachments.' }));
    expect(describeProblems([...crowded, { name: 'z.png', reason: 'It is empty.' }])).toEqual(['a.txt, b.txt, c.txt and 2 more: A message takes at most 20 attachments.', 'z.png: It is empty.']);
  });
});

describe('the size on a chip', () => {
  test('is in bytes, KB or MB, short enough for a chip', () => {
    expect([0, 999, 1024, 1536, 10 * 1024, 1024 * 1024 - 1, 1024 * 1024, 2.5 * 1024 * 1024, 25 * 1024 * 1024].map(sizeText)).toEqual(['0 B', '999 B', '1 KB', '2 KB', '10 KB', '1024 KB', '1.0 MB', '2.5 MB', '25.0 MB']);
  });
});
