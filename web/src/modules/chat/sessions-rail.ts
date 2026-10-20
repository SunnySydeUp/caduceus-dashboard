// The session rail (M8 #09 step B): titles and times, with the filters behind one button and the maintenance actions behind another. This holds what the
// two menus list, which filters are on, what each one asks of the list, the word a row says when the session needs the owner, and the quiet footer. Pure.
import type { IconName } from '../../icons.tsx';
import { sourceLabel, type ListScope, type SessionItem, type SessionsTab, type SessionsView, type SessionStats } from './sessions-model.ts';

/** The two kinds of session the list tells apart; a segment at the top of the Filters menu. */
export const KIND_OPTIONS: readonly { value: SessionsTab; label: string }[] = [
  { value: 'chats', label: 'Chats' },
  { value: 'automation', label: 'Automation' },
];

export type FilterId = 'failed' | 'quiet' | 'all' | 'archived' | 'source' | 'project' | 'new-project';

/** The filters that are a switch: one key in the address that is there or is not. */
export type SwitchFilterId = Extract<FilterId, 'failed' | 'quiet' | 'all' | 'archived' | 'project'>;

export interface FilterItem {
  id: FilterId;
  label: string;
  icon: IconName;
  /** The filter narrows (or widens) the list now. */
  on: boolean;
  /** What a choice is set to (the source), where a switch has only on and off. */
  value?: string;
  /** Why the entry cannot be used now. */
  disabled?: string;
}

/** Whether the list shows every profile's sessions in the view a scope opens on. */
const defaultAll = (scope: ListScope): boolean => scope === 'everyone';

/** Grouping by project is of one profile's own sessions: it takes effect only while the list is not across all of them. */
const groupedByProject = (view: SessionsView): boolean => view.group === 'project' && !view.all;

/** The entries of the Filters menu, with how each stands in `view`. New project is there only while the list is grouped by project. */
export function filterItems(view: SessionsView, scope: ListScope): FilterItem[] {
  const grouped = groupedByProject(view);
  return [
    { id: 'failed', label: 'Failed only', icon: 'failed', on: view.failed },
    { id: 'quiet', label: 'Hide API noise', icon: 'server', on: view.quiet },
    { id: 'all', label: 'All profiles', icon: 'users', on: view.all !== defaultAll(scope) },
    { id: 'archived', label: 'Archived', icon: 'archive', on: view.archived === true },
    { id: 'source', label: 'Source', icon: 'filter', on: view.source !== undefined, value: view.source === undefined ? 'Any' : sourceLabel(view.source) },
    {
      id: 'project',
      label: 'By project',
      icon: 'folder',
      on: grouped,
      ...(view.all ? { disabled: 'Projects belong to one profile: switch off All profiles to group by project.' } : {}),
    },
    ...(grouped ? [{ id: 'new-project' as const, label: 'New project', icon: 'plus' as const, on: false }] : []),
  ];
}

/** How many filters are on, for the badge on the Filters button. Automation counts: the list is not the chats then. */
export function filterCount(view: SessionsView, scope: ListScope): number {
  return (view.tab === 'chats' ? 0 : 1) + filterItems(view, scope).filter((entry) => entry.on).length;
}

/** The view with one switch turned over; everything else in it stays. */
export function setFilter(view: SessionsView, id: SwitchFilterId): SessionsView {
  switch (id) {
    case 'failed':
      return { ...view, failed: !view.failed };
    case 'quiet':
      return { ...view, quiet: !view.quiet };
    case 'all':
      return { ...view, all: !view.all };
    case 'archived': {
      const { archived: _archived, ...rest } = view;
      return view.archived ? rest : { ...rest, archived: true };
    }
    case 'project': {
      const { group: _group, ...rest } = view;
      return view.group === 'project' ? rest : { ...rest, group: 'project' };
    }
  }
}

export type MoreId = 'refresh' | 'compact' | 'select' | 'import' | 'foreign' | 'cleanup';

export interface MoreItem {
  id: MoreId;
  label: string;
  icon: IconName;
  /** The item is a switch (it stays on until it is turned off), not an action that runs once. */
  toggle: boolean;
  /** The action changes Hermes's data or setup, so it carries the app's change mark (the tier of the write is the action's own). */
  changesHermes: boolean;
}

/** The entries of the More menu, in the order they are listed. */
export const MORE_ITEMS: readonly MoreItem[] = [
  { id: 'refresh', label: 'Refresh', icon: 'refresh', toggle: false, changesHermes: false },
  { id: 'compact', label: 'Compact view', icon: 'rows', toggle: true, changesHermes: false },
  { id: 'select', label: 'Select sessions', icon: 'check', toggle: true, changesHermes: false },
  { id: 'import', label: 'Import', icon: 'upload', toggle: false, changesHermes: true },
  { id: 'foreign', label: 'Claude Code & Codex', icon: 'code', toggle: false, changesHermes: false },
  { id: 'cleanup', label: 'Clean up', icon: 'trash', toggle: false, changesHermes: true },
];

/** The words a row says when its session needs the owner. */
export type StateWord = 'Needs you' | 'Failed' | 'Draft';

/**
 * A row is a title and a time. It says one word more only when the session needs the owner: it waits on an answer, it ended badly, or an unsent draft
 * of the owner's is in it. When several apply the most urgent is the word. A running session and an unread one need nothing of the owner (the row
 * shows an unread title in a heavier weight, and says nothing for a running one).
 */
export function stateWord({ item, live, drafted }: { item: SessionItem; live: 'running' | 'waiting' | undefined; drafted: boolean }): StateWord | undefined {
  if (live === 'waiting') return 'Needs you';
  if (item.failed) return 'Failed';
  if (drafted) return 'Draft';
  return undefined;
}

const plural = (n: number, noun: string): string => `${n.toLocaleString('en-US')} ${noun}${n === 1 ? '' : 's'}`;

/** The quiet line under the list: how many sessions, and across how many profiles when the list is across them. Nothing until Hermes has answered. */
export function footerLine({ view, stats, total, loaded, profiles }: { view: SessionsView; stats: SessionStats | undefined; total: number; loaded: boolean; profiles: number }): string {
  if (view.all) return loaded ? `${plural(total, 'session')} across ${plural(profiles, 'profile')}` : '';
  return stats ? plural(stats.sessions, 'session') : '';
}
