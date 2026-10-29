import { describe, expect, test } from 'vitest';
import { quietIds, shownBanners, type Banner } from '../src/shell/banners.ts';

// A banner that is news and not a fault (an update is available) arrives after the page has painted and must not push it down: it waits for the next page.
const banner = (id: string, quiet?: boolean): Banner => ({ id, priority: 1, tone: 'info', icon: 'download', title: id, ...(quiet ? { quiet } : {}) });

describe('quiet banners', () => {
  const all = [banner('offline'), banner('update-available:hermes', true), banner('update-available:caduceus', true)];

  test('are held back while the page is the one they arrived on, and every other banner shows at once', () => {
    expect(shownBanners(all, []).map((shown) => shown.id)).toEqual(['offline']);
  });

  test('show with the next page: a page change lets in every quiet banner that is waiting', () => {
    const letIn = quietIds(all);

    expect(letIn).toEqual(['update-available:hermes', 'update-available:caduceus']);
    expect(shownBanners(all, letIn).map((shown) => shown.id)).toEqual(['offline', 'update-available:hermes', 'update-available:caduceus']);
  });

  test('that arrive later wait for the page after that one', () => {
    const letIn = quietIds(all);

    expect(shownBanners([...all, banner('update', true)], letIn).map((shown) => shown.id)).not.toContain('update');
  });
});

describe('banners that stay away from a page', () => {
  const update: Banner = { ...banner('update-available:hermes', true), hideOn: ['/system/maintenance', '/chat'] };

  test('do not show on the page they link to, or under a path they name, even when let in', () => {
    const letIn = [update.id];

    expect(shownBanners([update], letIn, '/today').map((shown) => shown.id)).toEqual([update.id]);
    expect(shownBanners([update], letIn, '/system/maintenance')).toEqual([]);
    expect(shownBanners([update], letIn, '/chat')).toEqual([]);
    expect(shownBanners([update], letIn, '/chat/s1')).toEqual([]);
    // A path that only starts with the same letters is another page.
    expect(shownBanners([update], letIn, '/chatter').map((shown) => shown.id)).toEqual([update.id]);
  });

  test('a banner with no such paths shows everywhere', () => {
    expect(shownBanners([banner('offline')], [], '/chat/s1').map((shown) => shown.id)).toEqual(['offline']);
  });
});
