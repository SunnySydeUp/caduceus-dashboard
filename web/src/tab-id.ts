// Which tab of the browser a gateway socket belongs to, so that the Caduceus server can give a tab that dropped and came back
// (a locked phone, a reload) the upstream it held for it (architecture §4, the grace hold). No DOM: the page's storage is passed in.

/** The `sessionStorage` key: it lives as long as the tab does, through reloads, and is not shared with other tabs. */
const TAB_KEY = 'caduceus.tab';

/**
 * This tab's id, made on first use and kept in the tab's own storage. A duplicated tab copies its storage and so its id: the
 * two then hold one upstream between them, one at a time, which costs a reconnect and nothing more.
 */
export function tabId(store: Pick<Storage, 'getItem' | 'setItem'>, random: () => string = () => crypto.randomUUID()): string {
  const known = store.getItem(TAB_KEY);
  if (known) return known;
  const made = random();
  store.setItem(TAB_KEY, made);
  return made;
}

/** The address of Caduceus's gateway route, naming the tab: `ws://host/api/ws?tab=…`. */
export function gatewayUrl({ protocol, host }: { protocol: string; host: string }, tab: string): string {
  return `${protocol === 'https:' ? 'wss:' : 'ws:'}//${host}/api/ws?tab=${encodeURIComponent(tab)}`;
}
