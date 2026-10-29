import { useId, useMemo, useState, type FormEvent } from 'react';
import type { BudgetInput, BudgetPeriod, BudgetStatus } from '@caduceus/contracts/budgets';
import { BUDGET_PERIODS } from '@caduceus/contracts/budgets';
import { Icon } from '../../icons.tsx';
import { Sheet } from '../../overlays/Sheet.tsx';
import { useSearch } from '@tanstack/react-router';
import { AppLink, useAppNavigate } from '../../shell/navigation.tsx';
import { Loading, useTakingLonger } from '../../shell/Loading.tsx';
import { PageHeader } from '../../shell/PageHeader.tsx';
import { useProfileScope } from '../../shell/profile-context.tsx';
import { RadioGroup } from '../../shell/RadioGroup.tsx';
import { Term } from '../../shell/Term.tsx';
import { toast } from '../../shell/toasts.ts';
import { useSizeClass } from '../../shell/use-size-class.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { BudgetGuard } from './BudgetGuard.tsx';
import { budgetView, dollars, PERIOD_WORDS, type BudgetsClient } from './budgets-model.ts';
import { Bars, ChartFigure, HBars, Heatmap } from './charts.tsx';
import { useBudgets, useInsights, useQuota, type InsightsData, type Loaded, type QuotaState } from './insights-data.ts';
import { bySource, cacheShare, clampDays, costOf, daysFromSearch, dailySeries, heatmap, hourOfDay, MAX_DAYS, MIN_DAYS, PERIOD_CHOICES, tokensOf, type Amounts } from './insights-model.ts';
import './insights.css';

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat('en');
const money = (usd: number) => (usd > 0 && usd < 0.01 ? '<$0.01' : `$${usd.toFixed(2)}`);
const percent = (value: number) => `${Math.round(value)}%`;

type DaysChoice = `${(typeof PERIOD_CHOICES)[number]}` | 'custom';

/** The period: 7, 30, 90 or 365 days at one tap, or any number from 1 to 365. A phone keeps it in a sheet. */
function PeriodPicker({ days, onChange }: { days: number; onChange(days: number): void }) {
  const phone = useSizeClass() === 'compact';
  const [open, setOpen] = useState(false);
  // What is being typed, so the box can be emptied and refilled; it shows the period again once left.
  const [draft, setDraft] = useState<string>();
  const labelled = useId();
  const typed = useId();
  const preset = (PERIOD_CHOICES as readonly number[]).includes(days);
  const controls = (
    <div className="ins-period">
      <span id={labelled} className="sr-only">
        Period
      </span>
      <RadioGroup<DaysChoice>
        labelledBy={labelled}
        className="seg"
        value={preset ? (String(days) as DaysChoice) : 'custom'}
        options={[...PERIOD_CHOICES.map((choice) => ({ value: String(choice) as DaysChoice, label: `${choice} days` })), { value: 'custom', label: 'Other' }]}
        onChange={(next) => {
          if (next !== 'custom') onChange(Number(next));
        }}
      />
      <label className="ins-period__custom" htmlFor={typed}>
        <span>Days</span>
        <input
          id={typed}
          className="input"
          type="number"
          inputMode="numeric"
          min={MIN_DAYS}
          max={MAX_DAYS}
          value={draft ?? days}
          onChange={(event) => {
            setDraft(event.currentTarget.value);
            const value = event.currentTarget.valueAsNumber;
            if (Number.isFinite(value)) onChange(clampDays(value));
          }}
          onBlur={() => setDraft(undefined)}
        />
      </label>
    </div>
  );
  if (!phone) return controls;
  return (
    <>
      <button type="button" className="btn btn--secondary" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <Icon name="calendar" />
        Last {days} {days === 1 ? 'day' : 'days'}
      </button>
      {open && (
        <Sheet title="Period" detents={['auto']} onClose={() => setOpen(false)}>
          {controls}
        </Sheet>
      )}
    </>
  );
}

function Tile({ label, value, sub }: { label: React.ReactNode; value: string; sub?: React.ReactNode }) {
  return (
    <div className="panel panel--pad ins-tile">
      <dt className="subtle">{label}</dt>
      <dd>
        <strong>{value}</strong>
        {sub && <span className="subtle">{sub}</span>}
      </dd>
    </div>
  );
}

/** The room of the summary tiles while Hermes adds the usage up: the same grid as the answer, so nothing jumps; slow, it says so and offers a retry. */
function UsageSkeleton({ onRetry }: { onRetry(): void }) {
  const late = useTakingLonger(true);
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">{late ? 'Loading usage from Hermes. This is taking longer than usual.' : 'Loading usage from Hermes…'}</span>
      <div className="ins-tiles" aria-hidden="true">
        {Array.from({ length: 5 }, (_, index) => (
          <div key={index} className="panel panel--pad ins-tile">
            <span className="skel loading__line" style={{ inlineSize: '50%' }} />
            <span className="skel loading__line" />
          </div>
        ))}
      </div>
      {late && (
        <p className="loading__late">
          <span className="muted">Taking longer than usual. Hermes may be busy.</span>
          <button type="button" className="btn btn--secondary btn--sm" onClick={onRetry}>
            <Icon name="refresh" />
            <span>Retry</span>
          </button>
        </p>
      )}
    </div>
  );
}

function Summary({ data }: { data: InsightsData }) {
  const { totals } = data.insights;
  const share = cacheShare(totals);
  return (
    <>
    <dl className="ins-tiles">
      <Tile label="Tokens" value={compact.format(tokensOf(totals))} sub={`${compact.format(totals.inputTokens)} in · ${compact.format(totals.outputTokens)} out`} />
      <Tile
        label="Cost"
        value={money(data.insights.cost)}
        sub={
          <>
            Estimated {money(totals.estimatedCost)} · Billed {totals.actualCost > 0 ? money(totals.actualCost) : 'none reported'}
          </>
        }
      />
      <Tile label="Cache tokens" value={compact.format(totals.cacheReadTokens)} sub={share === undefined ? 'None read' : `${percent(share)} of the prompt`} />
      <Tile label="Reasoning tokens" value={compact.format(totals.reasoningTokens)} />
      <Tile label="Sessions" value={whole.format(data.activity?.sessions ?? totals.sessions)} sub={data.activity ? `${whole.format(data.activity.messages)} messages` : undefined} />
    </dl>
    <p className="subtle ins-note">
      <Term id="cost">Cost</Term> is the provider’s bill where Hermes has one, else its estimate; both are shown. <Term id="cache-tokens">Cache tokens</Term> were read from the provider’s cache instead of processed again.
    </p>
    </>
  );
}

function Charts({ data, days }: { data: InsightsData; days: number }) {
  const { insights, sessions } = data;
  // Cost until the period has none to show (a local model has no price): then the tokens, so the chart is not an empty box.
  const [chosen, setMetric] = useState<'cost' | 'tokens'>();
  const metric = chosen ?? (insights.daily.some((row) => costOf(row) > 0) ? 'cost' : 'tokens');
  const metricLabel = useId();
  const now = Date.now();
  const series = useMemo(() => dailySeries(insights.daily, days, now), [insights.daily, days, now]);
  const since = now / 1000 - days * 86_400;
  const sources = useMemo(() => (sessions ? bySource(sessions.rows, since) : []), [sessions, since]);
  const hours = useMemo(() => (sessions ? hourOfDay(sessions.rows, since) : []), [sessions, since]);
  const weeks = useMemo(() => heatmap(insights.daily, Math.min(days, 365), now), [insights.daily, days, now]);
  const values = series.map((row) => (metric === 'cost' ? costOf(row) : tokensOf(row)));
  const show = (value: number) => (metric === 'cost' ? money(value) : compact.format(value));
  const modelsByCost = insights.models.some((row) => costOf(row) > 0);
  const label = (row: Amounts) => `${money(costOf(row))} · ${compact.format(tokensOf(row))} tokens`;
  const sourceNote = sessions?.truncated ? ' This is the newest 2,000 sessions of the period.' : '';
  const activeDays = insights.daily.filter((row) => row.sessions > 0);

  return (
    <div className="ins-charts">
      <ChartFigure
        title="Per day (UTC days)"
        summary={`${metric === 'cost' ? 'Cost' : 'Tokens'} for each of the last ${days} ${days === 1 ? 'day' : 'days'}; the busiest day was ${show(Math.max(...values, 0))}.`}
        table={{ head: ['Day', 'Tokens', 'Estimated cost', 'Billed cost', 'Sessions'], rows: series.filter((row) => row.sessions > 0 || tokensOf(row) > 0).map((row) => [row.day, whole.format(tokensOf(row)), money(row.estimatedCost), row.actualCost > 0 ? money(row.actualCost) : '–', row.sessions]) }}
        wide
        actions={
          <div className="ins-metric">
            <span id={metricLabel} className="sr-only">
              Chart shows
            </span>
            <RadioGroup<'cost' | 'tokens'> labelledBy={metricLabel} className="seg" value={metric} options={[{ value: 'cost', label: 'Cost' }, { value: 'tokens', label: 'Tokens' }]} onChange={setMetric} />
          </div>
        }
      >
        <Bars values={values} first={series[0]!.day} last={series.at(-1)!.day} />
      </ChartFigure>
      <ChartFigure
        title="By model"
        summary={insights.models.length === 0 ? 'No model has been used in this period.' : `${insights.models[0]!.model} used the most: ${label(insights.models[0]!)}. These numbers include the helper calls Hermes makes for titles and summaries, so they can be higher than the totals above.`}
        table={{ head: ['Model', 'Tokens', 'Estimated cost', 'Sessions'], rows: insights.models.map((row) => [row.model, whole.format(tokensOf(row)), money(row.estimatedCost), row.sessions]) }}
      >
        <HBars rows={insights.models.slice(0, 8).map((row) => ({ label: row.model, value: modelsByCost ? costOf(row) : tokensOf(row), text: label(row) }))} />
      </ChartFigure>
      {insights.profiles.length > 1 && (
        <ChartFigure
          title="By profile"
          summary={`${insights.profiles[0]!.profile} used the most: ${money(insights.profiles[0]!.cost)} · ${compact.format(tokensOf(insights.profiles[0]!))} tokens.`}
          table={{ head: ['Profile', 'Tokens', 'Cost', 'Sessions'], rows: insights.profiles.map((row) => [row.profile, whole.format(tokensOf(row)), money(row.cost), row.sessions]) }}
        >
          <HBars rows={insights.profiles.map((row) => ({ label: row.profile, value: row.cost || tokensOf(row), text: `${money(row.cost)} · ${compact.format(tokensOf(row))} tokens` }))} />
        </ChartFigure>
      )}
      {sessions && (
        <ChartFigure
          title="By source"
          summary={sources.length === 0 ? 'No sessions started in this period.' : `${sources[0]!.source} used the most: ${label(sources[0]!)}.${sourceNote}`}
          table={{ head: ['Source', 'Sessions', 'Tokens', 'Cost'], rows: sources.map((row) => [row.source, row.sessions, whole.format(tokensOf(row)), money(costOf(row))]) }}
        >
          <HBars rows={sources.slice(0, 8).map((row) => ({ label: row.source, value: costOf(row) || tokensOf(row) || row.sessions, text: `${label(row)} · ${row.sessions} ${row.sessions === 1 ? 'session' : 'sessions'}` }))} />
        </ChartFigure>
      )}
      <ChartFigure
        title="Activity (UTC days)"
        summary={activeDays.length === 0 ? 'No sessions in this period.' : `${activeDays.length} active ${activeDays.length === 1 ? 'day' : 'days'}; the busiest had ${Math.max(...activeDays.map((row) => row.sessions))} ${Math.max(...activeDays.map((row) => row.sessions)) === 1 ? 'session' : 'sessions'}.`}
        table={{ head: ['Day', 'Sessions'], rows: activeDays.map((row) => [row.day, row.sessions]) }}
        wide
      >
        <Heatmap weeks={weeks} />
      </ChartFigure>
      {sessions && (
        <ChartFigure
          title="Hour of day"
          summary={`When sessions started, on this device’s clock.${hours.some((count) => count > 0) ? ` Busiest hour: ${String(hours.indexOf(Math.max(...hours))).padStart(2, '0')}:00.` : ' None started in this period.'}${sourceNote}`}
          table={{ head: ['Hour', 'Sessions'], rows: hours.map((count, hour) => [`${String(hour).padStart(2, '0')}:00`, count]) }}
        >
          <Bars values={hours} first="00:00" last="23:00" tone="muted" />
        </ChartFigure>
      )}
      <ChartFigure
        title="Top skills"
        summary={insights.skills.length === 0 ? 'No skill was loaded or edited in this period.' : `${insights.skills[0]!.skill} was used most: ${insights.skills[0]!.total} times.`}
        table={{ head: ['Skill', 'Loaded', 'Edited'], rows: insights.skills.map((row) => [row.skill, row.views, row.edits]) }}
      >
        <HBars rows={insights.skills.slice(0, 8).map((row) => ({ label: row.skill, value: row.total, text: `${row.total}×` }))} />
      </ChartFigure>
    </div>
  );
}

/** The provider's account limits, from `session.usage`, or why there are none to show. */
function QuotaCard({ quota }: { quota: QuotaState }) {
  return (
    <section className="panel panel--pad ins-quota" aria-labelledby="ins-quota-title">
      <h2 id="ins-quota-title" className="section__title">
        Provider quota
      </h2>
      {quota.state === 'loading' && <Loading label="Asking your provider…" lines={2} />}
      {quota.state === 'none' && (
        <p className="subtle">
          Not available. Only some providers report account limits, and this one does not (or Hermes could not ask it).
        </p>
      )}
      {quota.state === 'ready' && (
        <>
          <p className="subtle">
            {quota.quota.title}
            {quota.quota.provider ? ` · ${quota.quota.provider}` : ''}
          </p>
          <ul className="ins-quota__windows">
            {quota.quota.windows.map((window) => (
              <li key={window.label}>
                <div className="ins-quota__row">
                  <strong>{window.label}</strong>
                  <span>{window.usedPercent === undefined ? 'Unavailable' : `${window.usedPercent}% used`}</span>
                </div>
                {window.usedPercent !== undefined && (
                  <div className="progress" role="progressbar" aria-label={`${window.label} used`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={window.usedPercent} data-tone={window.usedPercent >= 100 ? 'danger' : window.usedPercent >= 80 ? 'warning' : undefined}>
                    <i style={{ ['--p' as string]: `${Math.min(100, window.usedPercent)}%` }} />
                  </div>
                )}
                {window.note && <span className="subtle ins-quota__note">{window.note}</span>}
              </li>
            ))}
          </ul>
          {quota.quota.details.map((line) => (
            <p key={line} className="subtle">
              {line}
            </p>
          ))}
        </>
      )}
    </section>
  );
}

/** Adds or changes a budget: an amount, a period and a profile. The Tier 1 confirmation comes from the client. */
function BudgetSheet({ budget, profiles, client, onDone, onClose }: { budget: BudgetStatus | undefined; profiles: readonly string[]; client: BudgetsClient; onDone(): void; onClose(): void }) {
  const [amount, setAmount] = useState(budget ? String(budget.amount) : '');
  const [period, setPeriod] = useState<BudgetPeriod>(budget?.period ?? 'month');
  const [profile, setProfile] = useState(budget?.profile ?? '');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const amountId = useId();
  const profileId = useId();
  const periodLabel = useId();
  const choices = budget?.profile && !profiles.includes(budget.profile) ? [budget.profile, ...profiles] : profiles;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0 || Math.round(value * 100) !== value * 100) {
      setError('Give an amount above zero, in dollars and cents.');
      return;
    }
    const input: BudgetInput = { amount: value, period, profile: profile === '' ? undefined : profile };
    setBusy(true);
    setError(undefined);
    const outcome = await (budget ? client.change(budget.id, input) : client.add(input));
    setBusy(false);
    if (outcome.kind === 'failed') setError(outcome.message);
    if (outcome.kind !== 'done') return;
    toast(budget ? 'Budget changed' : 'Budget added', { tone: 'info' });
    onDone();
    onClose();
  };

  return (
    <Sheet title={budget ? 'Change budget' : 'Add budget'} detents={['auto']} initialFocus={`#${CSS.escape(amountId)}`} onClose={onClose}>
      <form className="ins-form" onSubmit={(event) => void submit(event)} noValidate>
        <label className="field" htmlFor={amountId}>
          <span className="field__label">Amount (US dollars)</span>
          <input id={amountId} className="input" type="number" inputMode="decimal" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.currentTarget.value)} aria-invalid={error ? true : undefined} />
        </label>
        <div className="field">
          <span className="field__label" id={periodLabel}>
            Per
          </span>
          <RadioGroup<BudgetPeriod> labelledBy={periodLabel} className="seg" value={period} options={BUDGET_PERIODS.map((value) => ({ value, label: PERIOD_WORDS[value].noun.replace(/^./, (letter) => letter.toUpperCase()) }))} onChange={setPeriod} />
        </div>
        <label className="field" htmlFor={profileId}>
          <span className="field__label">Counts</span>
          <select id={profileId} className="input" value={profile} onChange={(event) => setProfile(event.currentTarget.value)}>
            <option value="">Every profile</option>
            {choices.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <p className="subtle">Days, weeks (Monday to Sunday) and months are counted in UTC, as Hermes counts them. Caduceus tells you at 80% and 100%; it does not stop anything.</p>
        {error && (
          <div className="banner" data-tone="danger" role="alert">
            <Icon name="alert" />
            <span className="banner__content">{error}</span>
          </div>
        )}
        <div className="ins-form__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <WriteButton type="submit" className="btn btn--primary" disabled={busy} aria-busy={busy}>
            {budget ? 'Save changes' : 'Add budget'}
          </WriteButton>
        </div>
      </form>
    </Sheet>
  );
}

function Budgets({ budgets, client, profiles, reload }: { budgets: Loaded<BudgetStatus[]>; client: BudgetsClient; profiles: readonly string[]; reload(): Promise<void> }) {
  const [editing, setEditing] = useState<BudgetStatus | 'new'>();
  const now = Date.now();

  const remove = async (budget: BudgetStatus) => {
    const outcome = await client.remove(budget);
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    if (outcome.kind === 'done') {
      toast('Budget deleted', { tone: 'info' });
      await reload();
    }
  };

  return (
    <section className="ins-budgets" aria-labelledby="ins-budgets-title">
      <div className="section__head">
        <h2 id="ins-budgets-title" className="section__title">
          Budgets
        </h2>
        <WriteButton type="button" className="btn btn--secondary btn--sm" aria-haspopup="dialog" onClick={() => setEditing('new')}>
          <Icon name="plus" />
          Add budget
        </WriteButton>
      </div>
      <p className="subtle ins-note">
        A <Term id="budget">budget</Term> is an amount for a day, week or month. Caduceus tells you in Notices at 80% and 100%. At 100% the budget guard below also stops unattended work.
      </p>
      {budgets.state === 'loading' && <Loading label="Loading budgets…" lines={2} onRetry={() => void reload()} />}
      {budgets.state === 'failed' && (
        <div className="banner" data-tone="warning" role="alert">
          <Icon name="alert" />
          <span className="banner__content">{budgets.message}</span>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => void reload()}>
            Retry
          </button>
        </div>
      )}
      {budgets.state === 'ready' && budgets.value.length === 0 && (
        <div className="panel panel--pad ins-empty">
          <p>No budgets yet. A budget tells you in Notices when spending reaches 80% and 100% of an amount you choose.</p>
          <WriteButton type="button" className="btn btn--primary" aria-haspopup="dialog" onClick={() => setEditing('new')}>
            <Icon name="plus" />
            Add budget
          </WriteButton>
        </div>
      )}
      {budgets.state === 'ready' && budgets.value.length > 0 && (
        <ul className="ins-budgetlist">
          {budgets.value.map((budget) => {
            const view = budgetView(budget, now);
            return (
              <li key={budget.id} className="panel panel--pad ins-budget">
                <div className="ins-budget__head">
                  <h3>{view.title}</h3>
                  <div className="ins-budget__actions">
                    <WriteButton type="button" className="btn btn--ghost btn--sm" aria-label={`Change the ${view.title} budget`} onClick={() => setEditing(budget)}>
                      Change
                    </WriteButton>
                    <WriteButton type="button" className="btn btn--ghost btn--sm" aria-label={`Delete the ${view.title} budget`} onClick={() => void remove(budget)}>
                      <Icon name="trash" />
                    </WriteButton>
                  </div>
                </div>
                <p className="ins-budget__summary">
                  <strong>{view.summary}</strong>
                  {view.percent !== undefined && <span className="tag" data-tone={view.tone === 'ok' ? undefined : view.tone}>{percent(view.percent)}</span>}
                </p>
                {view.percent !== undefined && (
                  <div className="progress" role="progressbar" aria-label={`${view.title}, spent`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.round(view.percent))} data-tone={view.tone === 'ok' ? undefined : view.tone}>
                    <i style={{ ['--p' as string]: `${Math.min(100, view.percent)}%` }} />
                  </div>
                )}
                {view.pace && (
                  <p className="subtle ins-budget__pace" data-over={view.paceOver ? '' : undefined}>
                    <Term id="spend-pace">Spend pace</Term>: {view.pace}
                    {view.paceOver ? ', which is over the budget.' : '.'}
                  </p>
                )}
                {budget.alerted.length > 0 && (
                  <p className="subtle">
                    Alerted at {budget.alerted.map((threshold) => `${threshold}%`).join(' and ')} this {PERIOD_WORDS[budget.period].noun}. <AppLink to="/notices">Open Notices</AppLink>
                  </p>
                )}
                <p className="subtle">
                  Period {budget.periodStart} to {budget.periodEnd} (UTC, end not included)
                </p>
              </li>
            );
          })}
        </ul>
      )}
      {editing && <BudgetSheet budget={editing === 'new' ? undefined : editing} profiles={profiles} client={client} onDone={() => void reload()} onClose={() => setEditing(undefined)} />}
    </section>
  );
}

/** Observe › Insights (M5 #05): Hermes's usage analytics as charts with table alternatives, the provider quota card, and budgets. */
export function Insights() {
  const { scope, hermes, effective } = useProfileScope();
  // The period lives in the address (`?days=`), so a reload and a shared link show the same period.
  const days = daysFromSearch(useSearch({ strict: false }) as Record<string, unknown>);
  const navigate = useAppNavigate();
  const setDays = (next: number) => void navigate(`/observe/insights?days=${next}`, { replace: true });
  const profiles = useMemo(() => (scope === 'all' ? (hermes?.profiles.map((profile) => profile.name) ?? []) : scope !== undefined ? [scope] : []), [scope, hermes]);
  const { data, reload } = useInsights(days, profiles, scope ?? 'all');
  const quota = useQuota(effective?.name);
  const budgets = useBudgets();
  const everyProfile = useMemo(() => hermes?.profiles.map((profile) => profile.name) ?? [], [hermes]);
  const empty = data.state === 'ready' && data.value.insights.totals.sessions === 0 && data.value.insights.daily.length === 0;

  return (
    <div className="ins">
      <PageHeader overline="Observe" title="Insights" subtitle={<>What your agents used and cost, from Hermes’s own accounting.</>} actions={<PeriodPicker days={days} onChange={setDays} />} />
      {data.state === 'loading' && <UsageSkeleton onRetry={reload} />}
      {data.state === 'failed' && (
        <div className="banner" data-tone="warning" role="alert">
          <Icon name="alert" />
          <span className="banner__content">{data.message}</span>
          <button type="button" className="btn btn--ghost btn--sm" onClick={reload}>
            Retry
          </button>
        </div>
      )}
      {data.state === 'ready' && data.value.unread.length > 0 && (
        <div className="banner" data-tone="warning" role="status">
          <Icon name="alert" />
          <span className="banner__content">Hermes could not read the usage of {data.value.unread.join(', ')}, so it is not in these numbers.</span>
        </div>
      )}
      {empty && (
        <div className="panel panel--pad ins-empty">
          <p>No usage yet in this period. Start a chat and its tokens and cost show up here.</p>
          <AppLink className="btn btn--primary" to="/chat">
            <Icon name="chat" />
            Start a chat
          </AppLink>
        </div>
      )}
      {data.state === 'ready' && !empty && (
        <>
          <Summary data={data.value} />
          <Charts data={data.value} days={days} />
        </>
      )}
      <QuotaCard quota={quota} />
      <Budgets budgets={budgets.budgets} client={budgets.client} profiles={everyProfile} reload={budgets.reload} />
      <BudgetGuard />
    </div>
  );
}
