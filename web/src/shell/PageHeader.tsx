import { useEffect, useRef, type ReactNode } from 'react';
import { claimHeadingFocus } from './focus-heading.ts';
import { setHeadingScrolledAway } from './heading-visibility.ts';

/** The title block every screen starts with: its `h1` takes focus after navigation and names the browser tab. */
/** `overlineAsIs`: the overline holds an id (`t_7a48…`), which is shown as it is written, not in capitals. `lead` is a mark before the title (a sigil). */
export function PageHeader({ overline, overlineAsIs, lead, title, subtitle, actions }: { overline?: string; overlineAsIs?: boolean; lead?: ReactNode; title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    document.title = `${title} · Caduceus Dashboard`;
  }, [title]);
  useEffect(() => {
    if (claimHeadingFocus()) heading.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    const element = heading.current;
    const bar = document.querySelector<HTMLElement>('.appbar');
    if (!element) return;
    setHeadingScrolledAway(false);
    // Scrolled away means it has gone up behind the app bar.
    const observer = new IntersectionObserver(([entry]) => setHeadingScrolledAway(!entry.isIntersecting), { rootMargin: `-${bar?.offsetHeight ?? 0}px 0px 0px 0px` });
    observer.observe(element);
    return () => {
      observer.disconnect();
      setHeadingScrolledAway(false);
    };
  }, [title]);

  const text = (
    <div className="page-header__text">
      {overline && <p className={overlineAsIs ? 'overline overline--as-is' : 'overline'}>{overline}</p>}
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
