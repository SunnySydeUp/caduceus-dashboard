import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { Icon } from '../icons.tsx';
import { Sheet } from '../overlays/Sheet.tsx';
import { dismissBanner, isAlert, quietIds, setStripShown, shownBanners, useBanners, type Banner } from './banners.ts';
import { useLinkHealth, useOnline } from './connection.ts';
import { clockWords } from './link-memory.ts';
import { AppLink, useRouteInfo } from './navigation.tsx';
import { useSizeClass } from './use-size-class.ts';

/** What the phone's details sheet adds while the device is offline: what still works, and what is switched off. */
const OFFLINE_STILL_WORKS = 'You can still read what was loaded and move around the app. Buttons that need a connection are switched off.';

/** A banner's buttons and links (it may have none). */
function BannerActions({ banner }: { banner: Banner }) {
  if (!banner.actions) return null;
  return (
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
  );
}

/**
 * Whether the stack is drawn, and whether it is open: a stack that has something to say glides open (its height runs from nothing to its own, `.banners__glide`), and
 * one that has nothing left glides shut before it leaves, so the page below it is moved smoothly and never jumps by the banner's height. Under reduced motion the
 * durations are 0 and it is at once. A stack on the page when it loads is open from the first paint.
 */
function useGlide(present: boolean, glide: RefObject<HTMLElement | null>): { drawn: boolean; open: boolean } {
  const [drawn, setDrawn] = useState(present);
  const [open, setOpen] = useState(present);
  useLayoutEffect(() => {
    if (present) {
      // The closed stack has been laid out (`getBoundingClientRect`) before it opens, so the change has something to run from.
      glide.current?.getBoundingClientRect();
      setDrawn(true);
      setOpen(true);
      return;
    }
    setOpen(false);
    const ms = glide.current ? parseFloat(getComputedStyle(glide.current).transitionDuration) * 1000 : 0;
    const timer = setTimeout(() => setDrawn(false), ms);
    return () => clearTimeout(timer);
  }, [present, glide]);
  return { drawn: drawn || present, open: open && present };
}

/**
 * The banner stack under the app bar (information architecture §3): one banner shows, ordered by priority, and the
 * rest wait behind a "+N more" pill. It renders nothing, and takes no space, when there is nothing to say; arriving and leaving it glides (`useGlide`).
 * From 600 px, while the connection banner is the one showing, the stack is sticky at the top of the page column: Hermes
 * being unreachable is said in words that stay in view while the page scrolls (healthy shows nothing). Its height goes to `--banner-h`,
 * which `--shell-top` reads, so the page's other sticky parts (Talk's header, a table's head) stand under it. On a phone the connection banner is a one-line strip
 * under the app bar ("Offline since 11:58", sticky): a tap opens the full words in a bottom sheet, so an open banner never pins a card in the page for the length of an outage.
 * The strip is the one alert; the sheet is a dialog, and the app bar's connection dot is silent while the strip shows (`setStripShown`), so the state is said once.
 */
export function BannerStack() {
  const all = useBanners();
  const { pathname } = useRouteInfo();
  const [open, setOpen] = useState(false);
  const stack = useRef<HTMLElement>(null);
  const glide = useRef<HTMLDivElement>(null);
  const phone = useSizeClass() === 'compact';
  const link = useLinkHealth();
  const online = useOnline();
  const [details, setDetails] = useState(false);
  // A quiet banner waits for the next page (`Banner.quiet`): the ones waiting when the page changes are let in with it, so they arrive with the new
  // page and move nothing. Set during this render, so that the banner and the new page are in the same paint.
  const [letIn, setLetIn] = useState<{ pathname: string; ids: readonly string[] }>({ pathname, ids: [] });
  if (letIn.pathname !== pathname) setLetIn({ pathname, ids: quietIds(all) });
  const current = shownBanners(all, letIn.ids, pathname);
  // Shutting, the stack keeps saying what it said (and says it to no one: it is inert and raises no alert) until it has glided closed.
  const said = useRef<Banner[]>(current);
  if (current.length > 0) said.current = current;
  const leaving = current.length === 0;
  const banners = leaving ? said.current : current;
  const { drawn, open: revealed } = useGlide(!leaving, glide);
  const shown = open ? banners : banners.slice(0, 1);
  const first = shown[0];
  const strip = phone && first?.id === 'connection';
  const sticky = drawn && !open && first?.id === 'connection';
  const since = !link.healthy && link.lastHealthyAt !== undefined ? clockWords(link.lastHealthyAt, Date.now()) : undefined;
  useEffect(() => {
    if (!strip || leaving) setDetails(false);
  }, [strip, leaving]);
  useEffect(() => {
    setStripShown(strip && !leaving);
    return () => setStripShown(false);
  }, [strip, leaving]);
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
  if (!drawn) return null;
  return (
    <section className="banners" ref={stack} data-sticky={sticky ? '' : undefined} data-strip={strip ? '' : undefined} aria-label="Notices" inert={leaving}>
      <div className="banners__glide" ref={glide} data-open={revealed ? '' : undefined}>
        <div className="banners__inner">
          <div className="banners__list">
            {/* The strip's own words are the announcement (a warning or a danger is an alert, as the full banner is): no hidden copy, so they are said once. */}
            {strip && first && (
              <div className="banner-strip__pin" role={!leaving && isAlert(first) ? 'alert' : undefined}>
                <button type="button" className="banner banner-strip" data-tone={first.tone} data-banner={first.id} aria-haspopup="dialog" onClick={() => setDetails(true)}>
                  <Icon name={first.icon} />
                  <span className="banner-strip__text">
                    <b>{first.stripTitle ?? first.title}</b>
                    {/* A real space, so the strip is said "Offline since 11:58" (flex items are not always spaced in the accessible name). */}
                    {since !== undefined && <span className="banner-strip__time">{' '}since {since}</span>}
                  </span>
                  <Icon name="chev-r" small />
                </button>
              </div>
            )}
            {(strip ? shown.slice(1) : shown).map((banner) => (
              <div key={banner.id} className="banner" data-tone={banner.tone} data-banner={banner.id} role={!leaving && isAlert(banner) ? 'alert' : undefined}>
                <Icon name={banner.icon} />
                <div className="banner__content">
                  <div className="banner__title">{banner.title}</div>
                  {banner.body && <div className="banner__body">{banner.body}</div>}
                  <BannerActions banner={banner} />
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
          {details && strip && first && (
            <Sheet title={first.title} onClose={() => setDetails(false)}>
              <div className="banner-details">
                {first.body && <p className="banner-details__body">{first.body}</p>}
                {/* While the device is offline the page is a reading mode: the sheet says what still works. */}
                {!online && first.id === 'connection' && <p className="banner-details__body">{OFFLINE_STILL_WORKS}</p>}
                <BannerActions banner={first} />
              </div>
            </Sheet>
          )}
        </div>
      </div>
    </section>
  );
}
