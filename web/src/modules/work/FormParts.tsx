// The small pieces the schedule builder's forms are made of: a labelled field with its help and its error, a number and a list that can be typed freely.
import { useId, useState, type ReactNode } from 'react';
import { Icon } from '../../icons.tsx';

/** What an input needs from its field: an id for the label, and the help and error that describe it. */
export interface FieldProps {
  id: string;
  'aria-describedby': string | undefined;
  'aria-invalid': true | undefined;
}

/** A labelled field. `error` shows when there is one to show; the input is marked invalid with it. */
export function Field({ label, help, error, children, name }: { label: ReactNode; help?: ReactNode; error?: string; children: (props: FieldProps) => ReactNode; name?: string }) {
  const id = useId();
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  const describedBy = [help ? helpId : undefined, error ? errorId : undefined].filter(Boolean).join(' ') || undefined;
  return (
    <div className="field" data-field={name}>
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {help && (
        <p id={helpId} className="field__help">
          {help}
        </p>
      )}
      {error && (
        <p id={errorId} className="field__error" role="alert">
          <Icon name="alert" small />
          {error}
        </p>
      )}
    </div>
  );
}

/** A whole number the owner types; empty is `undefined` and text that is not a number is `NaN`, which the form says is a problem. */
export function NumberInput({ value, onChange, onBlur, ...rest }: Omit<FieldProps, 'id'> & { id: string; value: number | undefined; onChange(value: number | undefined): void; onBlur?(): void; placeholder?: string; readOnly?: boolean }) {
  const [text, setText] = useState(value === undefined || Number.isNaN(value) ? '' : String(value));
  return (
    <input
      {...rest}
      className="input mono"
      inputMode="numeric"
      autoComplete="off"
      value={text}
      onBlur={onBlur}
      onChange={(event) => {
        setText(event.target.value);
        const trimmed = event.target.value.trim();
        onChange(trimmed === '' ? undefined : Number(trimmed));
      }}
    />
  );
}

const skillsOf = (text: string) => text.split(/[\s,]+/).filter(Boolean);

/** Names typed with commas or spaces between them, with the profile's own as suggestions. */
export function ListInput({ value, onChange, options, onBlur, ...rest }: Omit<FieldProps, 'id'> & { id: string; value: string[]; onChange(value: string[]): void; options?: readonly string[]; onBlur?(): void; placeholder?: string; readOnly?: boolean }) {
  const [text, setText] = useState(value.join(', '));
  const listId = useId();
  return (
    <>
      <input {...rest} className="input" autoComplete="off" autoCapitalize="none" spellCheck={false} list={options && options.length > 0 ? listId : undefined} value={text} onBlur={onBlur} onChange={(event) => {
        setText(event.target.value);
        onChange(skillsOf(event.target.value));
      }} />
      {options && options.length > 0 && (
        <datalist id={listId}>
          {options.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
      )}
    </>
  );
}
