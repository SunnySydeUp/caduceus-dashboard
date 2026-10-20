// The audit log in the Caduceus store: who did what to what, from where and when.
import type { AuditEntry, AuditPage, AuditRow } from '@caduceus/contracts/caduceus-api';
import type { Tier } from '@caduceus/contracts/policy/tiers';
import type { CaduceusStore } from './caduceus-store.ts';

export interface AuditLog {
  record(entry: Omit<AuditEntry, 'at'>): void;
  /** Newest first. */
  list(limit: number): AuditEntry[];
  /** The entries that match `filter`, newest first, `limit` at most, from just before entry `before`. */
  query(filter: AuditFilter, limit: number, before?: number): AuditPage;
}

/** What the viewer narrows the log by. Every part is optional; `from` and `to` are milliseconds since the epoch, both ends included. */
export interface AuditFilter {
  tier?: Tier;
  /** Entries whose action contains this text (case does not matter). */
  action?: string;
  profile?: string;
  from?: number;
  to?: number;
}

interface Row {
  id: number;
  at: number;
  actor: string;
  action: string;
  target: string;
  source: string;
  tier: Tier | null;
  profile: string | null;
}

/** A tier or profile the action had none of is left out, not null. */
const entryOf = ({ tier, profile, at, ...row }: Omit<Row, 'id'>): AuditEntry => ({ ...row, at: new Date(at).toISOString(), ...(tier ? { tier } : {}), ...(profile ? { profile } : {}) });

/** `LIKE` treats `%`, `_` and the escape as wildcards: the text a person typed is matched as typed. */
const likePattern = (text: string) => `%${text.replace(/[\\%_]/g, '\\$&')}%`;

export function createAuditLog(store: CaduceusStore, now: () => number): AuditLog {
  const { db } = store;
  return {
    record({ actor, action, target, source, tier, profile }) {
      db.prepare('INSERT INTO audit (at, actor, action, target, source, tier, profile) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        now(),
        actor,
        action,
        target,
        source,
        tier ?? null,
        profile ?? null,
      );
    },
    list(limit) {
      const rows = db.prepare('SELECT at, actor, action, target, source, tier, profile FROM audit ORDER BY id DESC LIMIT ?').all(limit) as unknown as Omit<Row, 'id'>[];
      return rows.map(entryOf);
    },
    query({ tier, action, profile, from, to }, limit, before) {
      const where: string[] = [];
      const params: (string | number)[] = [];
      const add = (clause: string, value: string | number) => {
        where.push(clause);
        params.push(value);
      };
      if (tier) add('tier = ?', tier);
      if (action) add("action LIKE ? ESCAPE '\\'", likePattern(action));
      if (profile) add('profile = ?', profile);
      if (from !== undefined) add('at >= ?', from);
      if (to !== undefined) add('at <= ?', to);
      const matching = where.length === 0 ? '' : ` WHERE ${where.join(' AND ')}`;
      const { total } = db.prepare(`SELECT COUNT(*) AS total FROM audit${matching}`).get(...params) as { total: number };
      const pageWhere = before === undefined ? matching : `${matching || ' WHERE 1 = 1'} AND id < ?`;
      const rows = db
        .prepare(`SELECT id, at, actor, action, target, source, tier, profile FROM audit${pageWhere} ORDER BY id DESC LIMIT ?`)
        .all(...params, ...(before === undefined ? [] : [before]), limit + 1) as unknown as Row[];
      const page = rows.slice(0, limit);
      const entries: AuditRow[] = page.map(({ id, ...row }) => ({ id, ...entryOf(row) }));
      return { entries, total, ...(rows.length > limit ? { nextBefore: page[page.length - 1].id } : {}) };
    },
  };
}
