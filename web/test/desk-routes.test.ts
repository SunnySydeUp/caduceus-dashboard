import { describe, expect, test } from 'vitest';
import { createAppRegistry } from '../src/modules/index.ts';

// Home and the Inbox's decision list are gone (M8 #08): Today replaced both. A bookmark, an old link or a notification sent before the cutover lands on Today. The router makes
// a redirect of each entry of this table (`router.tsx`), keeping the query string (`?profile=`).
describe('the addresses of the screens Today replaced', () => {
  const registry = createAppRegistry();
  const redirects = registry.redirects();
  const owned = registry.routes().map((route) => route.path);

  test.each(['/', '/home', '/inbox', '/inbox/:itemId'])('%s leads to Today, and no screen answers on it', (from) => {
    expect(redirects.filter((redirect) => redirect.from === from)).toEqual([{ from, to: '/today' }]);
    expect(owned).not.toContain(from);
  });

  test('Today is a screen, and Notices is where the rest of the Inbox went, on addresses of its own', () => {
    expect(owned).toEqual(expect.arrayContaining(['/today', '/notices', '/notices/:itemId']));
    expect(registry.module('notices')).toMatchObject({ desk: 'control', group: 'main', title: 'Notices' });
  });

  test('no module of Home or of the Inbox is registered any more', () => {
    expect(registry.module('home')).toBeUndefined();
    expect(registry.module('inbox')).toBeUndefined();
  });
});
