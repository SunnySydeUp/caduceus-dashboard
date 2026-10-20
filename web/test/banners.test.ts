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
