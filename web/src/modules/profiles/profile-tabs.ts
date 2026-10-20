// The tabs of a profile's detail (information architecture §5), in their order. A tab appears when its screen has landed:
// `ProfileDetail.tsx` lists the screens it has, and this keeps the order and the words. Later tickets add a screen there.
import type { IconName } from '../../icons.tsx';

export interface ProfileTab {
  /** The last segment of the address: `/agents/profiles/coder/identity`. Overview has none. */
  id: string;
  label: string;
  icon: IconName;
}

export const PROFILE_TABS: readonly ProfileTab[] = [
  { id: 'overview', label: 'Overview', icon: 'agents' },
  { id: 'identity', label: 'Identity', icon: 'user' },
  { id: 'instructions', label: 'Instructions', icon: 'book' },
  { id: 'memory', label: 'Memory', icon: 'database' },
  { id: 'skills', label: 'Skills', icon: 'stack' },
  { id: 'tools', label: 'Tools & MCP', icon: 'plug' },
  { id: 'model', label: 'Model', icon: 'cpu' },
  { id: 'gateway', label: 'Gateway & channels', icon: 'broadcast' },
  { id: 'files', label: 'Files', icon: 'folder' },
  { id: 'danger', label: 'Danger zone', icon: 'alert' },
];

/** The tabs whose screens exist, in the order of the list above. */
export function availableTabs(screens: readonly string[]): ProfileTab[] {
  return PROFILE_TABS.filter((tab) => screens.includes(tab.id));
}

/** The address of a tab of a profile; Overview is the profile's own address. */
export function tabPath(profile: string, tab: string): string {
  return tab === 'overview' ? `/agents/profiles/${profile}` : `/agents/profiles/${profile}/${tab}`;
}
