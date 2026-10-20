// What Settings › Security's audit viewer and sign-in methods say, as pure functions (M5 #15): the query the filters make, the day range the date fields mean, and the
// words for what a sign-in or a change of a method ended in.
import type { Tier } from '@caduceus/contracts/policy/tiers';

export interface AuditFilters {
  tier?: Tier;
  action?: string;
  profile?: string;
  /** ISO times; `to` is the last moment included. */
  from?: string;
  to?: string;
}

/** The query string of the entries route (or, with `format`, of the export): only the filters that are set, so an empty filter is the whole log. */
export function auditQuery(filters: AuditFilters, { before, limit, format }: { before?: number; limit?: number; format?: 'json' | 'csv' } = {}): string {
  const params = new URLSearchParams();
  for (const name of ['tier', 'action', 'profile', 'from', 'to'] as const) {
    const value = filters[name]?.trim();
    if (value) params.set(name, value);
  }
  if (before !== undefined) params.set('before', String(before));
  if (limit !== undefined) params.set('limit', String(limit));
  if (format) params.set('format', format);
  const text = params.toString();
  return text ? `?${text}` : '';
}

/** `YYYY-MM-DD` day fields (as a date input gives them, in the owner's time zone) as the first moment of `from` and the last of `to`. A day that is not set leaves that end open. */
export function dayRange(from: string, to: string): Pick<AuditFilters, 'from' | 'to'> {
  const range: Pick<AuditFilters, 'from' | 'to'> = {};
  const [fromYear, fromMonth, fromDay] = from.split('-').map(Number);
  const [toYear, toMonth, toDay] = to.split('-').map(Number);
  if (from) range.from = new Date(fromYear, fromMonth - 1, fromDay).toISOString();
  if (to) range.to = new Date(new Date(toYear, toMonth - 1, toDay + 1).getTime() - 1).toISOString();
  return range;
}

const SIGN_IN_ERRORS: Record<string, string> = {
  'oidc-disabled': 'Sign-in with your identity provider is off.',
  'oidc-state-invalid': 'That sign-in did not start here, or it took too long. Start it again.',
  'oidc-token-invalid': 'The identity provider’s answer could not be trusted, so nobody was signed in.',
  'oidc-user-not-allowed': 'The identity provider signed in someone who is not the one Caduceus allows.',
  'oidc-provider-error': 'The identity provider did not answer as it should. Try again, or sign in another way.',
  'oidc-origin': 'Caduceus cannot send you to the provider from this address. Open it at its usual address and try again.',
};

/** What the sign-in page says for the `error` the way back from the provider ended in; `undefined` for none or one it does not know. */
export function signInErrorMessage(code: string | null): string | undefined {
  return code ? SIGN_IN_ERRORS[code] : undefined;
}

/** What a refused change of a sign-in method means for the owner. */
export function methodRefusal(code: string | undefined, message: string | undefined): string {
  if (code === 'oidc-test-failed') return `The provider did not pass the test, so OIDC stays as it was.${message ? ` ${message}` : ''}`;
  if (code === 'identity-not-seen' && message) return message;
  if (code === 'step-up-required') return 'Not changed: confirming with a passkey was cancelled.';
  return 'Caduceus could not make the change.';
}
