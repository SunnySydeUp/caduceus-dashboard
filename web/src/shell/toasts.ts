import { useSyncExternalStore } from 'react';
import type { Tone } from './banners.ts';

export interface ToastOptions {
  tone?: Extract<Tone, 'success' | 'info' | 'warning' | 'danger'>;
  /** A smaller second line, e.g. the exact value that changed. */
  detail?: string;
  /** Makes it an undo toast (6 s, actionable from the keyboard). */
  undo?(): void;
  action?: { label: string; onClick(): void };
  /** Milliseconds before it goes away; 0 keeps it until dismissed. Danger toasts persist by default. */
  timeout?: number;
}

export interface Toast extends ToastOptions {
  id: number;
  message: string;
}

/** At most this many toasts show at once; the oldest makes way. */
const MAX_TOASTS = 3;
let nextId = 0;
let toasts: Toast[] = [];
const listeners = new Set<() => void>();

const publish = (next: Toast[]) => {
  toasts = next;
  listeners.forEach((notify) => notify());
};

/** Shows a toast in the polite live region above the tab bar. It never covers primary actions. */
export function toast(message: string, options: ToastOptions = {}): number {
  const id = ++nextId;
  publish([...toasts, { id, message, ...options }].slice(-MAX_TOASTS));
  return id;
}

export function dismissToast(id: number): void {
  publish(toasts.filter((t) => t.id !== id));
}

const subscribe = (notify: () => void) => {
  listeners.add(notify);
  return () => void listeners.delete(notify);
};

export function useToasts(): Toast[] {
  return useSyncExternalStore(subscribe, () => toasts);
}
