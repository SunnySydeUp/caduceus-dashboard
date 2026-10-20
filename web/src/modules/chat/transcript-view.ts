// What the View menu of Talk's header holds (M8 #09, the last pass), free of the DOM and of React. The transcript's tools (find, expand all, collapse all, copy, the role
// filters) and the activity mode used to be a row of buttons above the thread; they are one button now, and each is a row of its menu. This file says which rows a chat
// has; the menu draws them and carries each one out (`TranscriptView.tsx`).
import { ROLES, type Role } from './transcript-tools.ts';
import { ACTIVITY_MODES, type ActivityMode } from './activity.ts';

/** A row of the View menu. */
export type ViewRow = 'find' | 'expand' | 'collapse' | 'copy' | `role:${Role}` | `activity:${ActivityMode}`;

/** The rows of the menu, in order. The transcript's tools need messages to work on; the activity mode is the owner's to choose before the first reply. */
export function viewRows({ hasMessages }: { hasMessages: boolean }): ViewRow[] {
  const tools: ViewRow[] = hasMessages ? ['find', 'expand', 'collapse', 'copy', ...ROLES.map((role) => `role:${role}` as const)] : [];
  return [...tools, ...ACTIVITY_MODES.map((mode) => `activity:${mode}` as const)];
}

/** Every control reachable now, as `view > row`. For the table that says nothing was lost. */
export function viewPaths(facts: { hasMessages: boolean }): string[] {
  return viewRows(facts).map((row) => `view > ${row}`);
}
