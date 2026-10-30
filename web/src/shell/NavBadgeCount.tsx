import { useSyncExternalStore } from 'react';
import type { NavBadge } from '../module-registry.ts';
import { RollingNumber } from './RollingNumber.tsx';

const never = () => () => {};
const none = () => 0;

/** The count a module puts on its nav entry. Nothing while it is zero; the number is for the eye (it rolls when it changes) and `label` for a screen reader. */
export function NavBadgeCount({ badge }: { badge: NavBadge | undefined }) {
  const count = useSyncExternalStore(badge?.subscribe ?? never, badge?.count ?? none);
  if (!badge || count === 0) return null;
  return (
    <>
      <span className="count" aria-hidden="true">
        <RollingNumber value={count} ceiling={99} />
      </span>
      <span className="sr-only">{badge.label(count)}</span>
    </>
  );
}
