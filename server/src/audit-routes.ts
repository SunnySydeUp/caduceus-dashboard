// The audit log viewer (M5 #15): the entries Caduceus recorded, filtered by tier, action, profile and date, and exported as JSON or CSV. It only reads: the log
// has no route that changes or removes an entry.
import type { Context, Hono } from 'hono';
import type { AuditEntry } from '@caduceus/contracts/caduceus-api';
import type { Tier } from '@caduceus/contracts/policy/tiers';
import type { AuditFilter, AuditLog } from './audit-log.ts';
import type { AuthEnv } from './auth-routes.ts';

const TIERS: readonly string[] = ['T0', 'T1', 'T2', 'T3', 'denied'];
const PAGE_DEFAULT = 100;
const PAGE_MAX = 1000;
/** The most an export holds: more than the viewer shows in a year of heavy use, and a bound on the memory it takes. */
const EXPORT_MAX = 50_000;
const CSV_COLUMNS = 'time,actor,tier,action,target,profile,source';

/** The filters a request names, or the reason one is refused. A filter that is not understood is refused, never ignored: it would show more than was asked. */
function readFilter(c: Context): { ok: true; filter: AuditFilter } | { ok: false; field: string } {
  const filter: AuditFilter = {};
  const tier = c.req.query('tier');
  if (tier) {
    if (!TIERS.includes(tier)) return { ok: false, field: 'tier' };
    filter.tier = tier as Tier;
  }
  const action = c.req.query('action');
  if (action) filter.action = action;
  const profile = c.req.query('profile');
  if (profile) filter.profile = profile;
  for (const field of ['from', 'to'] as const) {
    const text = c.req.query(field);
    if (!text) continue;
    const at = Date.parse(text);
    if (Number.isNaN(at)) return { ok: false, field };
    filter[field] = at;
  }
  return { ok: true, filter };
}

/** A whole number from a query, within bounds; `undefined` when it is absent, `null` when it is not one. */
function readNumber(c: Context, name: string, { min, max }: { min: number; max: number }): number | undefined | null {
  const text = c.req.query(name);
  if (text === undefined || text === '') return undefined;
  const value = Number(text);
  return Number.isInteger(value) && value >= min && value <= max ? value : null;
}

/** A spreadsheet runs a cell that starts with one of these as a formula: a target or an action may hold text from outside, so it is made plain text. */
const FORMULA_START = /^[=+\-@\t\r]/;

function csvCell(value: string | undefined): string {
  const text = value ?? '';
  const plain = FORMULA_START.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(plain) ? `"${plain.replace(/"/g, '""')}"` : plain;
}

const csvRow = (entry: AuditEntry) => [entry.at, entry.actor, entry.tier, entry.action, entry.target, entry.profile, entry.source].map(csvCell).join(',');

export function mountAuditRoutes(app: Hono<AuthEnv>, audit: AuditLog, now: () => number): void {
  app.get('/_caduceus/api/audit/entries', (c) => {
    const read = readFilter(c);
    if (!read.ok) return c.json({ error: 'bad-request', field: read.field }, 400);
    const limit = readNumber(c, 'limit', { min: 1, max: PAGE_MAX });
    const before = readNumber(c, 'before', { min: 1, max: Number.MAX_SAFE_INTEGER });
    if (limit === null) return c.json({ error: 'bad-request', field: 'limit' }, 400);
    if (before === null) return c.json({ error: 'bad-request', field: 'before' }, 400);
    return c.json(audit.query(read.filter, limit ?? PAGE_DEFAULT, before));
  });

  app.get('/_caduceus/api/audit/export', (c) => {
    const read = readFilter(c);
    if (!read.ok) return c.json({ error: 'bad-request', field: read.field }, 400);
    const format = c.req.query('format') ?? 'json';
    if (format !== 'json' && format !== 'csv') return c.json({ error: 'bad-request', field: 'format' }, 400);
    const entries = audit.query(read.filter, EXPORT_MAX).entries.map(({ id: _id, ...entry }): AuditEntry => entry);
    const stamp = new Date(now()).toISOString().replace(/[:.]/g, '-');
    const headers = { 'content-disposition': `attachment; filename="caduceus-audit-${stamp}.${format}"` };
    if (format === 'json') return c.body(JSON.stringify(entries, null, 2), 200, { ...headers, 'content-type': 'application/json; charset=utf-8' });
    return c.body(`${[CSV_COLUMNS, ...entries.map(csvRow)].join('\n')}\n`, 200, { ...headers, 'content-type': 'text/csv; charset=utf-8' });
  });
}
