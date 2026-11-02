import { useSyncExternalStore } from 'react';
import type { NavBadge } from '../module-registry.ts';
import { RollingNumber } from './RollingNumber.tsx';

const never = () => () => {};
const none = () => 0;

/** The count a module puts on its nav entry, live. An entry that names itself with the count in its own label reads it here. */
export function useNavBadgeCount(badge: NavBadge | undefined): number {
  return useSyncExternalStore(badge?.subscribe ?? never, badge?.count ?? none);
}

/**
 * The count a module puts on its nav entry. Nothing while it is zero; the number is for the eye (it rolls when it changes) and `label` for a screen reader. `part="count"`
 * is for an entry that says the words in its own name ("Control, 1 thing needs a look"): the number is then drawn by CSS from `data-count` (`.count[data-count]::after`), so it
 * is not text in the link and the link's name stays the words the link says (WCAG 2.5.3). It does not roll.
 */
export function NavBadgeCount({ badge, part }: { badge: NavBadge | undefined; part?: 'count' }) {
  const count = useNavBadgeCount(badge);
  if (!badge || count === 0) return null;
  if (part === 'count') return <span className="count" aria-hidden="true" data-count={count > 99 ? '99+' : String(count)} />;
  return (
    <>
      <span className="count" aria-hidden="true">
        <RollingNumber value={count} ceiling={99} />
      </span>
      <span className="sr-only">{badge.label(count)}</span>
    </>
  );
}
