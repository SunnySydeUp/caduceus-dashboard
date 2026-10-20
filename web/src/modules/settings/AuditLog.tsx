// Settings › Security › Audit log (M5 #15): what Caduceus recorded about who did what: the entries newest first, filtered by tier, action, profile and date, and exported.
// It only reads. A table on a wide screen; cards on a phone, with the filters in a sheet.
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { AuditPage, AuditRow } from '@caduceus/contracts/caduceus-api';
import { Icon } from '../../icons.tsx';
import { Sheet } from '../../overlays/Sheet.tsx';
import { PageHeader } from '../../shell/PageHeader.tsx';
import { Term } from '../../shell/Term.tsx';
import { toast } from '../../shell/toasts.ts';
import { useSizeClass } from '../../shell/use-size-class.ts';
import { auditQuery, dayRange, type AuditFilters } from './audit-model.ts';

const PAGE = 50;
const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' });
const TIERS = ['T1', 'T2', 'T3', 'denied'] as const;

function FilterForm({ initial, onApply, onClear }: { initial: FilterFields; onApply(fields: FilterFields): void; onClear(): void }) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    onApply({ tier: String(data.get('tier')), action: String(data.get('action')), profile: String(data.get('profile')), from: String(data.get('from')), to: String(data.get('to')) });
  };
  return (
    <form className="audit-filters" aria-label="Filter the audit log" onSubmit={submit}>
      <label>
        Tier
        <select name="tier" className="input" defaultValue={initial.tier}>
          <option value="">Any</option>
          {TIERS.map((tier) => (
            <option key={tier} value={tier}>
              {tier === 'denied' ? 'Denied' : tier}
            </option>
          ))}
        </select>
      </label>
      <label>
        Action contains
        <input name="action" className="input" defaultValue={initial.action} autoCapitalize="none" spellCheck={false} placeholder="sign-in, DELETE, passkey" />
      </label>
      <label>
        Profile
        <input name="profile" className="input" defaultValue={initial.profile} autoCapitalize="none" spellCheck={false} />
      </label>
      <label>
        From
        <input name="from" className="input" type="date" defaultValue={initial.from} />
      </label>
      <label>
        To
        <input name="to" className="input" type="date" defaultValue={initial.to} />
      </label>
      <div className="settings-actions">
        <button type="submit" className="btn btn--primary">
          Show
        </button>
        <button type="button" className="btn btn--secondary" onClick={onClear}>
          Clear filters
        </button>
      </div>
    </form>
  );
}

interface FilterFields {
  tier: string;
  action: string;
  profile: string;
  from: string;
  to: string;
}

const NONE: FilterFields = { tier: '', action: '', profile: '', from: '', to: '' };

const toFilters = (fields: FilterFields): AuditFilters => ({
  ...(fields.tier ? { tier: fields.tier as AuditFilters['tier'] } : {}),
  action: fields.action,
  profile: fields.profile,
  ...dayRange(fields.from, fields.to),
});

export function AuditLog() {
  const compact = useSizeClass() === 'compact';
  const [fields, setFields] = useState<FilterFields>(NONE);
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState<number>();
  const [next, setNext] = useState<number>();
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sheet, setSheet] = useState(false);
  const run = useRef(0);

  const load = useCallback(async (filters: AuditFilters, before?: number) => {
    const mine = ++run.current;
    setLoading(true);
    try {
      const res = await fetch(`/_caduceus/api/audit/entries${auditQuery(filters, { limit: PAGE, before })}`);
      if (res.status === 401) return location.assign(`/sign-in?next=${encodeURIComponent(location.pathname)}`);
      if (!res.ok) throw new Error(String(res.status));
      const page = (await res.json()) as AuditPage;
      if (mine !== run.current) return;
      setRows((before_) => (before === undefined ? page.entries : [...before_, ...page.entries]));
      setTotal(page.total);
      setNext(page.nextBefore);
      setFailed(false);
    } catch {
      if (mine === run.current) setFailed(true);
    }
    if (mine === run.current) setLoading(false);
  }, []);

  useEffect(() => void load(toFilters(NONE)), [load]);

  const apply = (next_: FilterFields) => {
    setFields(next_);
    setSheet(false);
    void load(toFilters(next_));
  };

  const download = async (format: 'json' | 'csv') => {
    const res = await fetch(`/_caduceus/api/audit/export${auditQuery(toFilters(fields), { format })}`).catch(() => undefined);
    if (!res?.ok) return toast('Caduceus could not export the log.', { tone: 'danger' });
    const url = URL.createObjectURL(await res.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? `caduceus-audit.${format}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const filtered = JSON.stringify(fields) !== JSON.stringify(NONE);
  return (
    <div className="page-stack audit">
      <PageHeader overline="Security" title="Audit log" subtitle={<span className="subtle">Everything Caduceus recorded: sign-ins, and every change and refusal</span>} />
      <p className="help-text" data-setting-field="audit/log" tabIndex={-1}>
        The <Term id="audit-log">audit log</Term> is read-only: nothing here can change or remove an entry. Secrets are never written to it.
      </p>
      <div className="audit-bar">
        {compact ? (
          <button type="button" className="btn btn--secondary" onClick={() => setSheet(true)}>
            <Icon name="filter" small />
            Filters{filtered ? ' (on)' : ''}
          </button>
        ) : (
          <FilterForm key={JSON.stringify(fields)} initial={fields} onApply={apply} onClear={() => apply(NONE)} />
        )}
        <div className="settings-actions">
          <button type="button" className="btn btn--secondary" onClick={() => void download('csv')}>
            <Icon name="download" small />
            Export CSV
          </button>
          <button type="button" className="btn btn--secondary" onClick={() => void download('json')}>
            <Icon name="download" small />
            Export JSON
          </button>
        </div>
      </div>
      <p role="status" aria-busy={loading}>
        {failed ? 'Caduceus could not read the log.' : total === undefined ? 'Reading the log…' : `${total} ${total === 1 ? 'entry' : 'entries'}${filtered ? ' match the filters' : ''}${rows.length < total ? `, ${rows.length} shown` : ''}`}
      </p>
      {rows.length > 0 &&
        (compact ? (
          <ul className="audit-cards">
            {rows.map((row) => (
              <li key={row.id} className="audit-card">
                <div className="audit-card__top">
                  <span className="audit-card__action">{row.action}</span>
                  {row.tier && <span className="chip">{row.tier}</span>}
                </div>
                <p className="audit-card__target">{row.target}</p>
                <p className="help-text">
                  {dateTime.format(Date.parse(row.at))} · {row.actor} · {row.source}
                  {row.profile ? ` · ${row.profile}` : ''}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <div className="audit-table-wrap">
            <table className="audit-table">
              <thead>
                <tr>
                  <th scope="col">Time</th>
                  <th scope="col">Actor</th>
                  <th scope="col">Tier</th>
                  <th scope="col">Action</th>
                  <th scope="col">Target</th>
                  <th scope="col">Profile</th>
                  <th scope="col">Source</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>{dateTime.format(Date.parse(row.at))}</td>
                    <td>{row.actor}</td>
                    <td>{row.tier ?? ''}</td>
                    <td>{row.action}</td>
                    <td className="audit-table__target">{row.target}</td>
                    <td>{row.profile ?? ''}</td>
                    <td>{row.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      {next !== undefined && (
        <button type="button" className="btn btn--secondary" disabled={loading} onClick={() => void load(toFilters(fields), next)}>
          Show older entries
        </button>
      )}
      {sheet && (
        <Sheet title="Filter the audit log" detents={['full']} onClose={() => setSheet(false)}>
          <FilterForm initial={fields} onApply={apply} onClear={() => apply(NONE)} />
        </Sheet>
      )}
    </div>
  );
}
