import { useLayoutEffect, useRef, useState } from 'react';
import { Icon } from '../icons.tsx';
import { dismissBanner, quietIds, shownBanners, useBanners } from './banners.ts';
import { AppLink, useRouteInfo } from './navigation.tsx';

/**
 * The banner stack under the app bar (information architecture §3): one banner shows, ordered by priority, and the
 * rest wait behind a "+N more" pill. It renders nothing, and takes no space, when there is nothing to say.
 * From 600 px, while the connection banner is the one showing, the stack is sticky at the top of the page column: Hermes
 * being unreachable is said in words that stay in view while the page scrolls (healthy shows nothing). Its height goes to `--banner-h`,
 * which `--shell-top` reads, so the page's other sticky parts (Talk's header, a table's head) stand under it.
 */
export function BannerStack() {
  const all = useBanners();
  const { pathname } = useRouteInfo();
  const [open, setOpen] = useState(false);
  const stack = useRef<HTMLElement>(null);
  // A quiet banner waits for the next page (`Banner.quiet`): the ones waiting when the page changes are let in with it, so they arrive with the new
  // page and move nothing. Set during this render, so that the banner and the new page are in the same paint.
  const [letIn, setLetIn] = useState<{ pathname: string; ids: readonly string[] }>({ pathname, ids: [] });
  if (letIn.pathname !== pathname) setLetIn({ pathname, ids: quietIds(all) });
  const banners = shownBanners(all, letIn.ids, pathname);
  const shown = open ? banners : banners.slice(0, 1);
  const sticky = !open && shown[0]?.id === 'connection';
  useLayoutEffect(() => {
    const element = stack.current;
    if (!sticky || !element) return;
    const root = document.documentElement;
    const measure = () => root.style.setProperty('--banner-h', `${element.offsetHeight}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
      root.style.removeProperty('--banner-h');
    };
  }, [sticky]);
  if (banners.length === 0) return null;
  return (
    <section className="banners" ref={stack} data-sticky={sticky ? '' : undefined} aria-label="Notices">
      <div className="banners__inner">
        {shown.map((banner) => (
          <div key={banner.id} className="banner" data-tone={banner.tone} role={banner.tone === 'warning' || banner.tone === 'danger' ? 'alert' : undefined}>
            <Icon name={banner.icon} />
            <div className="banner__content">
              <div className="banner__title">{banner.title}</div>
              {banner.body && <div className="banner__body">{banner.body}</div>}
              {banner.actions && (
                <div className="banner__actions">
                  {banner.actions.map((action) =>
                    action.to ? (
                      <AppLink key={action.label} className="btn btn--secondary btn--sm" to={action.to}>
                        {action.label}
                      </AppLink>
                    ) : (
                      <button key={action.label} type="button" className="btn btn--secondary btn--sm" onClick={action.onClick}>
                        {action.label}
                      </button>
                    ),
                  )}
                </div>
              )}
            </div>
            {banner.dismissible ? (
              <button type="button" className="btn btn--ghost btn--icon btn--sm" aria-label={`Dismiss: ${banner.title}`} onClick={() => dismissBanner(banner.id)}>
                <Icon name="x" />
              </button>
            ) : (
              <span />
            )}
          </div>
        ))}
        {banners.length > 1 && (
          <button type="button" className="chip banners__more" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? 'Show fewer' : `+${banners.length - 1} more`}
          </button>
        )}
      </div>
    </section>
  );
}
