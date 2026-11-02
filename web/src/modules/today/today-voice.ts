// Today's one voice for what its blocks cannot show. A block that is slow, that failed, or that has nothing to show offline reports it here; when two or more say the same
// thing (or, offline, when any has nothing), the page says it once at the top and the blocks step back to a quiet line, or out of the way. Pure model, plus the small store the
// blocks report to (`TodayBlock`) and the page reads (`TodayVoiceLine`).

/** What one block cannot show: still reading after the long wait, failed with a cause, or offline with nothing loaded. */
export type BlockReport = { title: string; kind: 'slow' } | { title: string; kind: 'failed'; cause: string; retry(): void } | { title: string; kind: 'unloaded' };

/** One line the page says for several blocks: which ones, by title, in the page's order. */
export type VoiceLine = { kind: 'unloaded'; titles: string[] } | { kind: 'failed'; cause: string; titles: string[]; retry(): void } | { kind: 'slow'; titles: string[] };

export interface TodayVoice {
  /** At most one line of each kind: unloaded (offline), then a failure cause, then slow. */
  lines: VoiceLine[];
  /** The blocks a line speaks for: they do not say it again. */
  spokenFor: ReadonlySet<string>;
}

export const SILENT: TodayVoice = { lines: [], spokenFor: new Set() };

/**
 * What the page says for its blocks. Offline, every block with nothing loaded is listed in one line (there is never more than one way to say "not loaded"). A cause that two or
 * more blocks failed with is said once, the cause most blocks share first (one line: a second cause stays in its blocks). Two or more slow blocks are said once. One block alone
 * says its own failure or slowness. `reports` is in the page's order.
 */
export function todayVoice(reports: ReadonlyArray<readonly [string, BlockReport]>): TodayVoice {
  const lines: VoiceLine[] = [];
  const spokenFor = new Set<string>();
  const unloaded = reports.filter(([, report]) => report.kind === 'unloaded');
  if (unloaded.length > 0) {
    lines.push({ kind: 'unloaded', titles: unloaded.map(([, report]) => report.title) });
    for (const [id] of unloaded) spokenFor.add(id);
  }
  const byCause = new Map<string, Array<readonly [string, Extract<BlockReport, { kind: 'failed' }>]>>();
  for (const [id, report] of reports) if (report.kind === 'failed') byCause.set(report.cause, [...(byCause.get(report.cause) ?? []), [id, report]]);
  const shared = [...byCause.values()].filter((group) => group.length >= 2).sort((a, b) => b.length - a.length)[0];
  if (shared) {
    const retries = shared.map(([, report]) => report.retry);
    lines.push({ kind: 'failed', cause: shared[0]![1].cause, titles: shared.map(([, report]) => report.title), retry: () => retries.forEach((retry) => retry()) });
    for (const [id] of shared) spokenFor.add(id);
  }
  const slow = reports.filter(([, report]) => report.kind === 'slow');
  if (slow.length >= 2) {
    lines.push({ kind: 'slow', titles: slow.map(([, report]) => report.title) });
    for (const [id] of slow) spokenFor.add(id);
  }
  return lines.length === 0 ? SILENT : { lines, spokenFor };
}

/** A list of titles in words: "Needs you", "Needs you and Reminders", "Needs you, Reminders and Today’s schedule". */
export function titleList(titles: readonly string[]): string {
  return titles.length <= 1 ? (titles[0] ?? '') : `${titles.slice(0, -1).join(', ')} and ${titles.at(-1)}`;
}

/** The reports of one page, in the page's order (`order`), and what the page says for them. Blocks report in effects; the page and the blocks read the voice. */
export class VoiceStore {
  private readonly reports = new Map<string, BlockReport>();
  private voice: TodayVoice = SILENT;
  private readonly listeners = new Set<() => void>();
  constructor(private readonly order: readonly string[]) {}

  report(id: string, report: BlockReport | undefined): void {
    const last = this.reports.get(id);
    const same = report === undefined ? last === undefined : last?.kind === report.kind && last.title === report.title && (last.kind !== 'failed' || (report.kind === 'failed' && last.cause === report.cause));
    if (same) {
      // Keep the newest retry, so that the page's Retry asks with the block's current read.
      if (report) this.reports.set(id, report);
      return;
    }
    if (report === undefined) this.reports.delete(id);
    else this.reports.set(id, report);
    const ordered = [...this.reports].sort(([a], [b]) => this.rank(a) - this.rank(b));
    this.voice = todayVoice(ordered);
    for (const listener of this.listeners) listener();
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly get = (): TodayVoice => this.voice;

  private rank(id: string): number {
    const at = this.order.indexOf(id);
    return at === -1 ? this.order.length : at;
  }
}
