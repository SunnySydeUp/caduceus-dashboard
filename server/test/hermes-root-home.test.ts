import { describe, expect, test } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { hermesRootHome } from '../src/hermes-root-home.ts';

// Where the Caduceus store goes: the Hermes root home, resolved the way Hermes's `get_default_hermes_root()`
// resolves it (`hermes_constants.py`), so `hermes backup` of that root includes the store.
describe('Hermes root home', () => {
  const native = path.join(os.homedir(), '.hermes');

  test.each([
    ['HERMES_HOME unset', undefined, native],
    ['the native home', native, native],
    ['a profile of the native home', path.join(native, 'profiles', 'coder'), native],
    ['a custom root', '/srv/hermes', '/srv/hermes'],
    ['a profile of a custom root', '/srv/hermes/profiles/coder', '/srv/hermes'],
    ['a home with ~ in it', '~/elsewhere/hermes', path.join(os.homedir(), 'elsewhere', 'hermes')],
  ])('%s', (_, HERMES_HOME, root) => {
    expect(hermesRootHome(HERMES_HOME === undefined ? {} : { HERMES_HOME })).toBe(root);
  });
});
