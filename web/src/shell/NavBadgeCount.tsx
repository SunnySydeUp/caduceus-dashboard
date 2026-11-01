import { useSyncExternalStore } from 'react';
import type { NavBadge } from '../module-registry.ts';
import { RollingNumber } from './RollingNumber.tsx';

const never = () => () => {};
const none = () => 0;

/**
 * The count a module puts on its nav entry. Nothing while it is zero; the number is for the eye (it rolls when it changes) and `label` for a screen reader. `part` draws only
 * one of the two, for an entry whose number sits on its icon but whose words must come after its name ("Control, 1 thing needs a look").
 */
export function NavBadgeCount({ badge, part }: { badge: NavBadge | undefined; part?: 'count' | 'words' }) {
  const count = useSyncExternalStore(badge?.subscribe ?? never, badge?.count ?? none);
  if (!badge || count === 0) return null;
  return (
    <>
      {part !== 'words' && (
        <span className="count" aria-hidden="true">
          <RollingNumber value={count} ceiling={99} />
        </span>
      )}
      {part !== 'count' && <span className="sr-only">{badge.label(count)}</span>}
    </>
  );
}
