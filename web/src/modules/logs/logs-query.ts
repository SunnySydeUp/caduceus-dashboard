// The address of a Logs view (M5 #06): the part of Logs that the model and the screen share.
import type { LogsView } from './logs-model.ts';

/** How many of the last lines Hermes is asked for when the address says nothing. */
export const DEFAULT_LINES = 200;

/** The query that carries a view; the default view (the agent log, 200 lines) is no query at all. */
export function logsSearch({ file, level, component, search, lines }: LogsView): Record<string, string> {
  return {
    ...(file === 'agent' ? {} : { file }),
    ...(level ? { level } : {}),
    ...(component ? { component } : {}),
    ...(search.trim() === '' ? {} : { q: search.trim() }),
    ...(lines === DEFAULT_LINES ? {} : { lines: String(lines) }),
  };
}
