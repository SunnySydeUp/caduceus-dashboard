import { useEffect, useRef, type ReactNode } from 'react';
import { crumbTrail } from './nav-order.ts';
import { claimHeadingFocus } from './focus-heading.ts';
import { setHeadingScrolledAway } from './heading-visibility.ts';
import { AppLink, useRouteInfo } from './navigation.tsx';
import { useRegistry } from './registry-context.tsx';
import { useSizeClass } from './use-size-class.ts';

/**
 * The title block every screen starts with: its `h1` takes focus after navigation and names the browser tab. From 600 px, where there is no app bar, a page below its
 * module's root (a task, Health under Observe) shows where it sits as linked text above the title, which stands for an overline that says the same place; on a phone the app bar's Back button does that.
 * `overlineAsIs`: the overline holds an id (`t_7a48…`), which is shown as it is written, not in capitals. `lead` is a mark before the title (a sigil).
 */
export function PageHeader({ overline, overlineAsIs, lead, title, subtitle, actions }: { overline?: string; overlineAsIs?: boolean; lead?: ReactNode; title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  const heading = useRef<HTMLHeadingElement>(null);
  const compact = useSizeClass() === 'compact';
  const registry = useRegistry();
  const info = useRouteInfo();
  const trail = compact ? [] : crumbTrail(registry, info);
  // The trail says where the page is, so an overline that starts with a place the trail names ("Observe · Repairs", "Work") would say it twice.
  const shownOverline = overline && !trail.some(({ label }) => overline.toLowerCase().startsWith(label.toLowerCase())) ? overline : undefined;

  useEffect(() => {
    document.title = `${title} · Caduceus Dashboard`;
  }, [title]);
  useEffect(() => {
    if (claimHeadingFocus()) heading.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    // Only the phone's app bar shows the title once the heading has gone: it is the one that reads this.
    const element = heading.current;
    const bar = document.querySelector<HTMLElement>('.appbar');
    if (!element || !bar) return;
    setHeadingScrolledAway(false);
    // Scrolled away means it has gone up behind the app bar.
    const observer = new IntersectionObserver(([entry]) => setHeadingScrolledAway(!entry.isIntersecting), { rootMargin: `-${bar.offsetHeight}px 0px 0px 0px` });
    observer.observe(element);
    return () => {
      observer.disconnect();
      setHeadingScrolledAway(false);
    };
  }, [title, compact]);

  const text = (
    <div className="page-header__text">
      {trail.length > 0 && (
        <nav aria-label="Breadcrumb">
          <ol className="crumbs">
            {trail.map((crumb) => (
              <li key={crumb.label}>
                <AppLink to={crumb.to}>{crumb.label}</AppLink>
              </li>
            ))}
          </ol>
        </nav>
      )}
      {shownOverline && <p className={overlineAsIs ? 'overline overline--as-is' : 'overline'}>{shownOverline}</p>}
      <h1 ref={heading} tabIndex={-1}>
        {title}
      </h1>
      {subtitle && <p className="page-header__sub">{subtitle}</p>}
    </div>
  );
  return (
    <header className="page-header">
      {lead ? (
        <div className="page-header__who">
          {lead}
          {text}
        </div>
      ) : (
        text
      )}
      {actions && <div className="page-header__actions">{actions}</div>}
    </header>
  );
}
