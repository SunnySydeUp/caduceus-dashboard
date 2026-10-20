import { useSyncExternalStore } from 'react';

/** From here the playbook inspector is a panel beside the stages, and the graph is offered; below it, a sheet and the list. The same width as `.pb__layout` in templates.css. */
const WIDE_QUERY = '(min-width: 64rem)';

const subscribe = (notify: () => void) => {
  const query = matchMedia(WIDE_QUERY);
  query.addEventListener('change', notify);
  return () => query.removeEventListener('change', notify);
};

/** Whether the window is 1024 px (64rem) or wider; it follows the window as it is resized. */
export const useWide = () => useSyncExternalStore(subscribe, () => matchMedia(WIDE_QUERY).matches);
