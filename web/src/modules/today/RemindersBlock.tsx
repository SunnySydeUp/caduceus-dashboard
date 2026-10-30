// Today's reminders: the owner's Apple Reminders (read from `remindctl` by the server) as an agenda, what is overdue, then today and tomorrow, under a strip of
// the week with a count on each day, so the rest of the week reads at a glance without a list. The strip unfolds into the month (a View Transition grows it in place: the week
// moves to where it sits in the month and the agenda slides down) for picking a day further out; picking one folds it again and lists that day. Read-only: nothing
// here completes or edits a reminder, so nothing looks like a checkbox. It loads by itself after Today has settled (it is a lazy chunk) and fails on its own, like
// every block. Reminders has no event to listen for, so it is read again when the tab comes back and when the gateway reconnects (`useBlock`); there is no timer.
import { useEffect, useId, useMemo, useState } from 'react';
import type { Reminder } from '@caduceus/contracts/today';
import { Icon } from '../../icons.tsx';
import { morph } from '../../motion.ts';
import { useBlock } from '../../use-block.ts';
import { TodayBlock } from './TodayBlocks.tsx';
import { agenda, dateKey, type DayCell, dayKey, monthCells, monthOf, overdueBefore, remindersOn, shiftDay, shiftMonth, timeWords, weekOf } from './reminders-model.ts';
import { readReminders } from './reminders-data.ts';
import './reminders.css';

/** The type its folds give the View Transition: `reminders.css` names the grid, the week and the agenda only while one runs. */
const REMINDERS_MORPH = { types: ['reminders'] };

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
/** How far ahead the agenda looks when it starts on today: today and tomorrow. The strip's counts carry the rest of the week. */
const AHEAD_DAYS = 2;
const noTarget = () => '/today';

const dayWords = (key: string, long = true) => new Date(`${key}T12:00:00`).toLocaleDateString([], { weekday: long ? 'long' : 'short', day: 'numeric', month: long ? 'long' : 'short' });

/** `overdueSince` is today's key when the row is in Overdue: its time is then its day (Yesterday, or the date); the hour, when it has one, goes with its list. */
function ReminderRow({ reminder, overdueSince }: { reminder: Reminder; overdueSince?: string }) {
  const overdue = overdueSince !== undefined;
  const when = overdue ? (dayKey(reminder) === shiftDay(overdueSince, -1) ? 'Yesterday' : dayWords(dayKey(reminder), false)) : timeWords(reminder);
  const meta = [overdue && timeWords(reminder), reminder.list].filter(Boolean).join(' · ');
  return (
    <li className="rem-row" data-done={reminder.completed || undefined}>
      <span className="rem-row__when">
        {reminder.completed ? (
          <>
            <Icon name="check" small />
            <span className="sr-only">Done, </span>
          </>
        ) : null}
        {when}
      </span>
      <span className="rem-row__text">
        <b>{reminder.title}</b>
        {meta && <small>{meta}</small>}
      </span>
    </li>
  );
}

function DayList({ title, reminders, overdueSince, none }: { title: string; reminders: Reminder[]; overdueSince?: string; none?: string }) {
  const id = useId();
  return (
    <section aria-labelledby={id}>
      <h3 className="rem__heading" id={id} data-tone={overdueSince === undefined ? undefined : 'danger'}>
        {title} {reminders.length > 0 && <span className="muted">{reminders.length}</span>}
      </h3>
      {reminders.length === 0 ? (
        <p className="subtle rem__none">{none}</p>
      ) : (
        <ul className="rem__rows">
          {reminders.map((reminder) => (
            <ReminderRow key={reminder.id} reminder={reminder} overdueSince={overdueSince} />
          ))}
        </ul>
      )}
    </section>
  );
}

function Calendar({ reminders, today }: { reminders: Reminder[]; today: string }) {
  // The day listed and the day whose week the folded strip shows; null follows today, so a Today left open overnight moves on to the new day by itself.
  const [selected, setSelected] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<string | null>(null);
  // The month the unfolded grid shows; set from the strip's week each time it unfolds.
  const [shown, setShown] = useState(() => monthOf(today));
  const [open, setOpen] = useState(false);
  const gridId = useId();
  const day = selected ?? today;
  const week = anchor ?? today;
  const weeks = useMemo(() => (open ? monthCells(shown.year, shown.month, reminders, today) : [weekOf(week, reminders, today)]), [open, shown, week, reminders, today]);
  const overdue = useMemo(() => (day === today ? overdueBefore(reminders, today) : []), [reminders, day, today]);
  const days = useMemo(() => (day === today ? agenda(reminders, today, AHEAD_DAYS) : [{ key: day, reminders: remindersOn(reminders, day) }]), [reminders, day, today]);
  const month = open ? shown : monthOf(week);
  const label = new Date(month.year, month.month, 1).toLocaleDateString([], { month: 'long', year: 'numeric' });
  const thisMonth = monthOf(today);
  const away = day !== today || (open ? shown.year !== thisMonth.year || shown.month !== thisMonth.month : !weeks[0]!.some((cell) => cell.today));

  const step = (by: number) => (open ? setShown((m) => shiftMonth(m, by)) : setAnchor(shiftDay(week, by * 7)));
  const toggle = () =>
    morph(() => {
      if (!open) setShown(monthOf(week));
      // Folding a month the strip's week is not in shows that month's first week (or this week, when it is this month).
      else if (!weeks.some((row) => row.some((cell) => cell.key === week)))
        setAnchor(shown.year === thisMonth.year && shown.month === thisMonth.month ? null : dateKey(new Date(shown.year, shown.month, 1)));
      setOpen(!open);
    }, REMINDERS_MORPH);
  const choose = (cell: DayCell) =>
    morph(() => {
      setSelected(cell.today ? null : cell.key);
      setAnchor(cell.today ? null : cell.key);
      setOpen(false);
    }, REMINDERS_MORPH);
  const backToToday = () =>
    morph(() => {
      setSelected(null);
      setAnchor(null);
      setOpen(false);
    }, REMINDERS_MORPH);

  return (
    <div className="rem panel">
      <div className="rem__bar">
        <h3 className="rem__month">
          <button type="button" className="rem__fold" aria-expanded={open} aria-controls={gridId} onClick={toggle}>
            {label}
            <span className="sr-only">, whole month</span>
            <Icon name={open ? 'chev-u' : 'chev-d'} small />
          </button>
        </h3>
        <span className="sr-only" role="status">
          {label}
        </span>
        {away && (
          <button type="button" className="btn btn--secondary btn--sm" onClick={backToToday}>
            Today
          </button>
        )}
        <button type="button" className="btn btn--ghost btn--icon" aria-label={open ? 'Previous month' : 'Previous week'} onClick={() => step(-1)}>
          <Icon name="chev-l" />
        </button>
        <button type="button" className="btn btn--ghost btn--icon" aria-label={open ? 'Next month' : 'Next week'} onClick={() => step(1)}>
          <Icon name="chev-r" />
        </button>
      </div>
      <table className="rem__grid" id={gridId} data-open={open || undefined}>
        <caption className="sr-only">
          {open ? label : `The week of ${dayWords(weeks[0]![0]!.key)}`}. Choose a day to see its reminders.
        </caption>
        <thead>
          <tr>
            {WEEKDAYS.map((name) => (
              <th key={name} scope="col" abbr={name}>
                {name[0]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((row) => (
            // The strip's week carries the same transition name folded and unfolded, so the browser moves it to its place in the month.
            <tr key={row[0]!.key} className={row.some((cell) => cell.key === week) ? 'rem__week' : undefined}>
              {row.map((cell) => (
                <td key={cell.key}>
                  <button
                    type="button"
                    className="rem__day"
                    data-out={(open && !cell.inMonth) || undefined}
                    data-today={cell.today || undefined}
                    data-selected={cell.key === day || undefined}
                    aria-pressed={cell.key === day}
                    aria-current={cell.today ? 'date' : undefined}
                    onClick={() => choose(cell)}
                  >
                    {/* Named by what it shows, so the spoken name starts with the visible date and count: "20 October, Tuesday, today, 3 to do, 1 done". */}
                    <span>
                      {cell.date}
                      <span className="sr-only">
                        {` ${new Date(`${cell.key}T12:00:00`).toLocaleDateString([], { month: 'long' })}, ${new Date(`${cell.key}T12:00:00`).toLocaleDateString([], { weekday: 'long' })}${cell.today ? ', today' : ''}`}
                      </span>
                    </span>
                    {/* How much is due, as a number; a day with only done reminders shows a tick. */}
                    <span className="rem__load">
                      {cell.open > 0 && (
                        <>
                          <span className="sr-only">, </span>
                          {cell.open}
                          <span className="sr-only"> to do</span>
                        </>
                      )}
                      {cell.open === 0 && cell.done > 0 && <Icon name="check" small />}
                      {cell.done > 0 && <span className="sr-only">{`, ${cell.done} done`}</span>}
                    </span>
                  </button>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="rem__list" aria-live="polite">
        {overdue.length > 0 && <DayList title="Overdue" reminders={overdue} overdueSince={today} />}
        {days.map(({ key, reminders: due }) => (
          <DayList
            key={key}
            title={key === today ? 'Today' : key === shiftDay(today, 1) ? 'Tomorrow' : dayWords(key)}
            reminders={due}
            none={`Nothing is due ${key === today ? 'today' : 'this day'}.`}
          />
        ))}
      </div>
    </div>
  );
}

/** Where this device remembers that the owner hid the Reminders trouble. It only hides the failure: Reminders come back by themselves when they can be read. */
const HIDDEN_KEY = 'caduceus.today.reminders-hidden';

function useHiddenTrouble(): [boolean, (hidden: boolean) => void] {
  const [hidden, setHidden] = useState(() => localStorage.getItem(HIDDEN_KEY) === '1');
  const change = (next: boolean) => {
    if (next) localStorage.setItem(HIDDEN_KEY, '1');
    else localStorage.removeItem(HIDDEN_KEY);
    setHidden(next);
  };
  return [hidden, change];
}

/** Reminders are optional, so when they cannot be read the block is one calm line: what is wrong is behind Details, Retry says it is trying, and Hide puts the line away on this device. */
function RemindersTrouble({ message, reload, onHide }: { message: string; reload(): void | Promise<void>; onHide(): void }) {
  const [retrying, setRetrying] = useState(false);
  const retry = () => {
    setRetrying(true);
    void Promise.resolve(reload()).finally(() => setRetrying(false));
  };
  return (
    <section className="today-block" aria-labelledby="today-reminders" data-block="reminders">
      <h2 className="today-block__title" id="today-reminders">
        Reminders
      </h2>
      <div className="today-quiet panel">
        <p className="subtle">Reminders are not available right now. Everything else on Today works.</p>
        <div className="today-quiet__acts">
          <button type="button" className="btn btn--secondary btn--sm" disabled={retrying} aria-busy={retrying} onClick={retry}>
            <Icon name="refresh" small />
            {retrying ? 'Retrying…' : 'Retry'}
          </button>
          <button type="button" className="btn btn--ghost btn--sm" onClick={onHide}>
            Hide
          </button>
        </div>
        <details className="today-quiet__details">
          <summary>Details</summary>
          <p className="subtle">{message}</p>
          <p className="subtle">Caduceus reads Reminders with the remindctl command on the Mac that runs it. Run “remindctl status” on that Mac to see what it needs.</p>
        </details>
      </div>
    </section>
  );
}

export function RemindersBlock({ now }: { now: number }) {
  const block = useBlock(readReminders, 'reminders', true);
  const { reload } = block;
  const [hidden, setHidden] = useHiddenTrouble();
  const { state } = block;
  useEffect(() => {
    const back = () => document.visibilityState === 'visible' && reload();
    document.addEventListener('visibilitychange', back);
    return () => document.removeEventListener('visibilitychange', back);
  }, [reload]);
  // Reminders that can be read again are shown again, hidden or not.
  useEffect(() => {
    if (state.status === 'ready' && hidden) setHidden(false);
  });
  if (hidden && state.status !== 'ready') return null;
  if (state.status === 'error') return <RemindersTrouble message={state.message} reload={reload} onHide={() => setHidden(true)} />;
  return (
    <TodayBlock id="reminders" title="Reminders" block={block} empty={() => undefined} room="22rem" to={noTarget}>
      {(reminders) => <Calendar reminders={reminders} today={dateKey(new Date(now))} />}
    </TodayBlock>
  );
}
