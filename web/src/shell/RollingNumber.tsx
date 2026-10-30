import { useState } from 'react';
import { motionReduced } from '../motion.ts';

/** What a roll is between: the number it rolls to, and the one it rolls away from (none at rest). */
interface Roll {
  value: number;
  from: number | undefined;
}

/**
 * A whole number that rolls to its next value: down when it drops (the old digits slide out below, the new ones come in from above), up when it grows. The first
 * value is drawn as it is, and under reduced motion a change is a plain swap. A screen reader gets the plain number once (the rolling digits are hidden from it).
 * `ceiling` caps what is drawn: above it the number reads "99+", say. The motion is in `sigil.css` (`.roll`). The old digits are taken away when the new ones have come
 * in or when their animation is cancelled (the number hidden meanwhile); a number that changes again mid-roll starts a roll of its own from what was drawn last.
 */
export function RollingNumber({ value, ceiling }: { value: number; ceiling?: number }) {
  const [roll, setRoll] = useState<Roll>({ value, from: undefined });
  const words = (number: number) => (ceiling !== undefined && number > ceiling ? `${ceiling}+` : String(number));
  // A change that reads the same ("99+" to "99+") has nothing to roll.
  if (roll.value !== value) setRoll({ value, from: motionReduced() || words(roll.value) === words(value) ? undefined : roll.value });
  const { from } = roll;
  // The listeners go with the element a change replaces (its key is its value), so an old roll never settles a newer one.
  const settle = (node: HTMLSpanElement | null) => {
    if (!node) return;
    const done = () => setRoll((now) => (now.from === undefined ? now : { value: now.value, from: undefined }));
    node.addEventListener('animationend', done);
    node.addEventListener('animationcancel', done);
    return () => {
      node.removeEventListener('animationend', done);
      node.removeEventListener('animationcancel', done);
    };
  };
  return (
    <span className="roll" data-dir={from === undefined ? undefined : value < from ? 'down' : 'up'}>
      <span className="sr-only">{words(value)}</span>
      {from !== undefined && (
        <span key={`out-${from}`} className="roll__out" aria-hidden="true">
          {words(from)}
        </span>
      )}
      <span key={`in-${value}`} ref={settle} className="roll__in" aria-hidden="true">
        {words(value)}
      </span>
    </span>
  );
}
