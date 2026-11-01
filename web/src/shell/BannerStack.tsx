import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from '../icons.tsx';
import { dismissBanner, quietIds, shownBanners, useBanners } from './banners.ts';
import { useLinkHealth } from './connection.ts';
import { clockWords } from './link-memory.ts';
import { AppLink, useRouteInfo } from './navigation.tsx';
import { useSizeClass } from './use-size-class.ts';

/**
 * The banner stack under the app bar (information architecture §3): one banner shows, ordered by priority, and the
 * rest wait behind a "+N more" pill. It renders nothing, and takes no space, when there is nothing to say.
 * From 600 px, while the connection banner is the one showing, the stack is sticky at the top of the page column: Hermes
 * being unreachable is said in words that stay in view while the page scrolls (healthy shows nothing). Its height goes to `--banner-h`,
 * which `--shell-top` reads, so the page's other sticky parts (Talk's header, a table's head) stand under it. On a phone the connection banner is a one-line strip
 * under the app bar (the title and since when, sticky); a tap opens the full banner under it, and a tap on the strip folds it again.
 */
export function BannerStack() {
  const all = useBanners();
  const { pathname } = useRouteInfo();
  const [open, setOpen] = useState(false);
  const stack = useRef<HTMLElement>(null);
  const phone = useSizeClass() === 'compact';
  const link = useLinkHealth();
  const [stripOpen, setStripOpen] = useState(false);
  // A quiet banner waits for the next page (`Banner.quiet`): the ones waiting when the page changes are let in with it, so they arrive with the new
  // page and move nothing. Set during this render, so that the banner and the new page are in the same paint.
  const [letIn, setLetIn] = useState<{ pathname: string; ids: readonly string[] }>({ pathname, ids: [] });
  if (letIn.pathname !== pathname) setLetIn({ pathname, ids: quietIds(all) });
  const banners = shownBanners(all, letIn.ids, pathname);
  const shown = open ? banners : banners.slice(0, 1);
  const first = shown[0];
  const strip = phone && first?.id === 'connection';
  const sticky = !open && first?.id === 'connection' && !(strip && stripOpen);
  useEffect(() => {
    if (!strip) setStripOpen(false);
  }, [strip]);
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
    <section className="banners" ref={stack} data-sticky={sticky ? '' : undefined} data-strip={strip ? '' : undefined} aria-label="Notices">
      <div className="banners__inner">
        {/* The strip's own words are the announcement (a warning or a danger is an alert, as the full banner is): no hidden copy, so they are said once. */}
        {strip && first && (
          <div role={first.tone === 'warning' || first.tone === 'danger' ? 'alert' : undefined}>
            <button type="button" className="banner banner-strip" data-tone={first.tone} aria-expanded={stripOpen} onClick={() => setStripOpen(!stripOpen)}>
              <Icon name={first.icon} />
              <span className="banner-strip__text">
                <b>{first.title}</b>
                {link.lastHealthyAt !== undefined && !link.healthy && <span> · since {clockWords(link.lastHealthyAt, Date.now())}</span>}
              </span>
              <Icon name={stripOpen ? 'chev-u' : 'chev-d'} small />
            </button>
          </div>
        )}
        {(strip ? (stripOpen ? shown : shown.slice(1)) : shown).map((banner) => (
          // The strip already announced its own banner: opened under it, that banner's full text is not a second alert.
          <div key={banner.id} className="banner" data-tone={banner.tone} role={(banner.tone === 'warning' || banner.tone === 'danger') && !(strip && banner === first) ? 'alert' : undefined}>
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
