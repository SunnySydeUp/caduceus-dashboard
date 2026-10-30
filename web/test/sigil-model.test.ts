import { describe, expect, test } from 'vitest';
import { SIGIL_CELLS, SIGIL_HUES, SIGIL_STATE_MARKS, sigilFor } from '../src/shell/sigil-model.ts';
import { crewStateLabel, type CrewStateName } from '../src/modules/crew/crew-state.ts';

// A profile's sigil comes from its name alone, so it looks the same on every screen and on every device.
describe('a sigil from a name', () => {
  const OWNER_PROFILES = ['coder', 'general', 'homeassistant', 'librarian', 'property'];

  test('is the same every time for the same name', () => {
    for (const name of [...OWNER_PROFILES, 'a', 'ünï-cødé', '']) {
      expect(sigilFor(name), name).toEqual(sigilFor(name));
    }
    // Pinned, so a change of the hash (which would repaint every profile everywhere) shows up as a failing test, not as a surprise.
    expect(OWNER_PROFILES.map((name) => sigilFor(name))).toMatchInlineSnapshot(`
      [
        {
          "hue": 1,
          "pattern": [
            "tl",
            "bl",
            "tr",
            "bl",
          ],
        },
        {
          "hue": 5,
          "pattern": [
            "sq",
            "br",
            "tl",
            "e",
          ],
        },
        {
          "hue": 6,
          "pattern": [
            "c",
            "c",
            "e",
            "bl",
          ],
        },
        {
          "hue": 4,
          "pattern": [
            "bl",
            "br",
            "br",
            "br",
          ],
        },
        {
          "hue": 2,
          "pattern": [
            "sq",
            "c",
            "sq",
            "e",
          ],
        },
      ]
    `);
  });

  test('is a 2 x 2 pattern of known cells and one of the hues, never blank', () => {
    for (const name of [...OWNER_PROFILES, 'x', 'research-assistant-7', 'new', '?', '']) {
      const { pattern, hue } = sigilFor(name);
      expect(pattern, name).toHaveLength(4);
      for (const cell of pattern) expect(SIGIL_CELLS, name).toContain(cell);
      expect(pattern.filter((cell) => cell !== 'e').length, `${name} is not blank`).toBeGreaterThanOrEqual(2);
      expect(Number.isInteger(hue) && hue >= 1 && hue <= SIGIL_HUES, `${name} hue ${hue}`).toBe(true);
    }
  });

  test('differs in both pattern and hue for each of the owner’s five profiles', () => {
    const marks = OWNER_PROFILES.map((name) => sigilFor(name));
    expect(new Set(marks.map(({ pattern }) => pattern.join(' '))).size).toBe(OWNER_PROFILES.length);
    expect(new Set(marks.map(({ hue }) => hue)).size).toBe(OWNER_PROFILES.length);
  });

  test('uses every cell shape and every hue across many names, so profiles are told apart', () => {
    const names = Array.from({ length: 400 }, (_, index) => `profile-${index}`);
    const cells = new Set(names.flatMap((name) => sigilFor(name).pattern));
    const hues = new Set(names.map((name) => sigilFor(name).hue));
    expect(cells).toEqual(new Set(SIGIL_CELLS));
    expect(hues.size).toBe(SIGIL_HUES);
  });
});

// A state is never shown by colour alone: each one that shows has its own ring shape, its own badge icon and a text label.
describe('what each crew state looks like', () => {
  const STATES: CrewStateName[] = ['waiting', 'working', 'done', 'blocked', 'idle'];
  const SHOWN = STATES.filter((state) => state !== 'idle');

  test('has a label for every state, each different and in plain words', () => {
    expect(Object.keys(crewStateLabel).sort()).toEqual([...STATES].sort());
    for (const state of STATES) expect(crewStateLabel[state].trim(), state).not.toBe('');
    expect(new Set(STATES.map((state) => crewStateLabel[state])).size).toBe(STATES.length);
  });

  test('gives each state that shows a ring and a badge icon of its own, so colour is never the only signal', () => {
    expect(Object.keys(SIGIL_STATE_MARKS).sort()).toEqual([...STATES].sort());
    for (const state of SHOWN) {
      expect(SIGIL_STATE_MARKS[state].ring, state).not.toBe('none');
      expect(SIGIL_STATE_MARKS[state].icon, state).toBeDefined();
    }
    expect(new Set(SHOWN.map((state) => SIGIL_STATE_MARKS[state].ring)).size).toBe(SHOWN.length);
    expect(new Set(SHOWN.map((state) => SIGIL_STATE_MARKS[state].icon)).size).toBe(SHOWN.length);
    // Idle is the absence of a state: no ring, no badge.
    expect(SIGIL_STATE_MARKS.idle).toEqual({ ring: 'none', icon: undefined });
  });

  // The design rules: Waiting for you never blinks (its ring is steady), and Running is the only state that loops (its ring is a sheen travelling round a track).
  test('keeps the waiting ring steady and gives only the running ring a motion', () => {
    expect(SIGIL_STATE_MARKS.waiting.ring).toBe('steady');
    expect(SIGIL_STATE_MARKS.working.ring).toBe('sheen');
    for (const state of STATES.filter((name) => name !== 'working')) expect(SIGIL_STATE_MARKS[state].ring, state).not.toBe('sheen');
  });
});
