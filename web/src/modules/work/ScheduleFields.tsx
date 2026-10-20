// The "When" of the builder: the six modes, the fields of the one that is chosen, and the next three times it fires.
import { useId } from 'react';
import { RadioGroup } from '../../shell/RadioGroup.tsx';
import { Term } from '../../shell/Term.tsx';
import { Field, NumberInput } from './FormParts.tsx';
import { relativeTime } from './schedules-model.ts';
import { nextFires, TIME_PROBLEM, type ScheduleDraft, type ScheduleMode } from './schedule-spec.ts';

const MODES: { value: ScheduleMode; label: string }[] = [
  { value: 'interval', label: 'Every…' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'once', label: 'Once' },
  { value: 'cron', label: 'Cron' },
];

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** The draft for a mode, keeping the time of day the owner already chose. */
function draftFor(mode: ScheduleMode, previous: ScheduleDraft): ScheduleDraft {
  const time = 'time' in previous ? previous.time : '09:00';
  switch (mode) {
    case 'interval':
      return { mode, every: 1, unit: 'hours' };
    case 'daily':
      return { mode, time };
    case 'weekly':
      return { mode, days: [1], time };
    case 'monthly':
      return { mode, day: 1, time };
    case 'once':
      return { mode, at: '' };
    case 'cron':
      return { mode, expression: '' };
  }
}

export function ScheduleFields({ schedule, onChange, error, touched, onTouch }: { schedule: ScheduleDraft; onChange(next: ScheduleDraft): void; error: string | undefined; touched: boolean; onTouch(): void }) {
  const labelId = useId();
  const shown = touched ? error : undefined;
  return (
    <div className="sb__when">
      <div className="field">
        <span className="field__label" id={labelId}>
          How often
        </span>
        <RadioGroup labelledBy={labelId} value={schedule.mode} options={MODES} onChange={(mode) => onChange(draftFor(mode, schedule))} className="seg sb__modes" />
      </div>
      {schedule.mode === 'interval' && (
        <div className="sb__row">
          <Field label="Every" error={shown}>
            {(aria) => <NumberInput {...aria} value={schedule.every} onChange={(every) => onChange({ ...schedule, every: every ?? Number.NaN })} onBlur={onTouch} />}
          </Field>
          <Field label="Unit">
            {(aria) => (
              <select {...aria} className="input" value={schedule.unit} onChange={(event) => onChange({ ...schedule, unit: event.target.value as 'minutes' | 'hours' | 'days' })}>
                <option value="minutes">minutes</option>
                <option value="hours">hours</option>
                <option value="days">days</option>
              </select>
            )}
          </Field>
        </div>
      )}
      {(schedule.mode === 'daily' || schedule.mode === 'weekly' || schedule.mode === 'monthly') && (
        <>
          {schedule.mode === 'weekly' && (
            <div className="field">
              <span className="field__label" id={`${labelId}-days`}>
                On
              </span>
              <div className="sb__days" role="group" aria-labelledby={`${labelId}-days`}>
                {WEEKDAYS.map((short, day) => (
                  <button
                    key={short}
                    type="button"
                    className="chip"
                    aria-pressed={schedule.days.includes(day)}
                    onClick={() => {
                      onChange({ ...schedule, days: schedule.days.includes(day) ? schedule.days.filter((candidate) => candidate !== day) : [...schedule.days, day].sort((a, b) => a - b) });
                      onTouch();
                    }}
                  >
                    {short}
                    <span className="sr-only">{WEEKDAY_NAMES[day].slice(3)}</span>
                  </button>
                ))}
              </div>
              {shown && shown !== TIME_PROBLEM && schedule.days.length === 0 && (
                <p className="field__error" role="alert">
                  {shown}
                </p>
              )}
            </div>
          )}
          {schedule.mode === 'monthly' && (
            <Field label="Day of the month" help="A month without that day is skipped: the 31st runs only in months with 31 days." error={shown !== TIME_PROBLEM ? shown : undefined}>
              {(aria) => <NumberInput {...aria} value={schedule.day} onChange={(day) => onChange({ ...schedule, day: day ?? Number.NaN })} onBlur={onTouch} />}
            </Field>
          )}
          <Field label="At" error={shown === TIME_PROBLEM ? shown : undefined}>
            {(aria) => <input {...aria} className="input" type="time" value={schedule.time} onChange={(event) => onChange({ ...schedule, time: event.target.value })} onBlur={onTouch} />}
          </Field>
        </>
      )}
      {schedule.mode === 'once' && (
        <Field label="Date and time" help="In your time zone. It runs once and then finishes." error={shown}>
          {(aria) => <input {...aria} className="input" type="datetime-local" value={schedule.at} onChange={(event) => onChange({ ...schedule, at: event.target.value })} onBlur={onTouch} />}
        </Field>
      )}
      {schedule.mode === 'cron' && (
        <Field
          label="Cron expression"
          help={
            <>
              Five fields: minute, hour, day of the month, month, weekday. For example 0 9 * * 1-5 is 09:00 on weekdays. <Term id="cron-expression">What is a cron expression?</Term>
            </>
          }
          error={shown}
        >
          {(aria) => <input {...aria} className="input input--mono" autoComplete="off" autoCapitalize="none" spellCheck={false} value={schedule.expression} onChange={(event) => onChange({ ...schedule, expression: event.target.value })} onBlur={onTouch} />}
        </Field>
      )}
    </div>
  );
}

const fireFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });

/** The next three times the schedule fires, worked out here from the text Hermes would be sent. */
export function FirePreview({ spec, now, fireZone, zone, problem }: { spec: string | undefined; now: number; fireZone: string; zone: string; problem?: string }) {
  const fires = spec !== undefined && problem === undefined ? nextFires(spec, now, fireZone) : [];
  return (
    <section className="sb__preview" aria-labelledby="sb-preview-title" aria-live="polite">
      <h3 id="sb-preview-title">Next three runs</h3>
      {fires.length === 0 ? (
        <p className="subtle">{problem ? 'Fix the schedule above to see when it runs.' : spec === undefined ? 'Fill in the inputs to see when it runs.' : 'It does not run again.'}</p>
      ) : (
        <ol className="sb__fires">
          {fires.map((at) => (
            <li key={at}>
              <time dateTime={new Date(at).toISOString()}>{fireFormat.format(at)}</time>
              <span className="subtle"> · {relativeTime(at, now)}</span>
            </li>
          ))}
        </ol>
      )}
      {fireZone !== zone && (
        <p className="field__help">
          Hermes keeps time in {fireZone}, so a time of day means that zone’s clock. The times above are shown in yours ({zone}).
        </p>
      )}
    </section>
  );
}
