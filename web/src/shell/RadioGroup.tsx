import { useRef, type KeyboardEvent, type ReactNode } from 'react';

export interface RadioOption<Value extends string> {
  value: Value;
  /** What the option shows; its text is the radio's accessible name. */
  label: ReactNode;
  /** Extra attributes for the option's button (a skin card sets `data-skin` so it renders in that skin). */
  attributes?: Record<`data-${string}`, string>;
}

/**
 * A group of radios drawn as buttons (the design system's Segmented control, and cards): one stop in the tab order, the
 * arrow keys move the choice (Home and End jump), as in the ARIA radio group pattern. `labelledBy` names the group.
 */
export function RadioGroup<Value extends string>({
  labelledBy,
  value,
  options,
  onChange,
  className,
  optionClassName,
}: {
  labelledBy: string;
  value: Value;
  options: readonly RadioOption<Value>[];
  onChange: (value: Value) => void;
  className: string;
  optionClassName?: string;
}) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
    const current = options.findIndex((option) => option.value === value);
    const moves: Record<string, number> = { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1, ArrowDown: 1, ArrowUp: -1 };
    let next: number;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = options.length - 1;
    else if (Object.hasOwn(moves, event.key)) next = (current + moves[event.key] + options.length) % options.length;
    else return;
    event.preventDefault();
    onChange(options[next].value);
    buttons.current[next]?.focus();
  };

  return (
    <div role="radiogroup" aria-labelledby={labelledBy} className={className} onKeyDown={onKeyDown}>
      {options.map((option, index) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            ref={(element) => void (buttons.current[index] = element)}
            type="button"
            role="radio"
            aria-checked={checked}
            // Roving tab stop: only the checked radio is in the tab order.
            tabIndex={checked ? 0 : -1}
            className={optionClassName}
            onClick={() => onChange(option.value)}
            {...option.attributes}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
