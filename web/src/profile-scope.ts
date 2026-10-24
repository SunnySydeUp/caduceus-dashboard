// Profile scope (information architecture §6, decision 6): the Hermes profile one browser tab works on.
//
// The effective profile is, in priority order: the `?profile=` URL parameter, this device's last choice, then
// Hermes's own default. Choosing a profile only ever touches the tab's URL and this device's memory; nothing here
// writes Hermes's sticky default (that is Profiles' "Make default", M4 #01).

export type ProfileSource = 'url' | 'device' | 'hermes';

export interface ProfileScopeInput {
  /** The `?profile=` parameter of this tab's URL. */
  urlProfile: string | undefined;
  /** The profile last chosen on this device. */
  deviceChoice: string | undefined;
  /** Hermes's sticky default profile. */
  hermesDefault: string;
  /** The profiles Hermes has; names outside it are ignored. `undefined` while they are still loading. */
  profiles: readonly string[] | undefined;
}

export function effectiveProfile({ urlProfile, deviceChoice, hermesDefault, profiles }: ProfileScopeInput): { name: string; source: ProfileSource } {
  const exists = (name: string | undefined): name is string => name !== undefined && (profiles === undefined || profiles.includes(name));
  if (exists(urlProfile)) return { name: urlProfile, source: 'url' };
  if (exists(deviceChoice)) return { name: deviceChoice, source: 'device' };
  return { name: hermesDefault, source: 'hermes' };
}

/** How a screen takes the tab's profile: one profile, cross-profile (All profiles until the URL names one), or locked to All profiles. */
export type ScopeMode = 'one' | 'cross' | 'all';

/** A module's scope mode from its registry flags: `allProfiles` wins over `crossProfile`; a route outside every module uses one profile. */
export function scopeMode(module: { allProfiles?: boolean; crossProfile?: boolean } | undefined): ScopeMode {
  if (module?.allProfiles) return 'all';
  return module?.crossProfile ? 'cross' : 'one';
}

/**
 * The scope a screen shows: always `all` on a screen locked to All profiles (Today), whatever the tab's profile; `all` on a cross-profile screen (Notices, Board,
 * Schedules, Insights) until the URL names a profile; otherwise the effective profile, `undefined` while it is not known yet.
 */
export function profileScope(effective: { name: string; source: ProfileSource } | undefined, mode: ScopeMode): string | undefined {
  if (mode === 'all') return 'all';
  if (effective === undefined) return undefined;
  return mode === 'cross' && effective.source !== 'url' ? 'all' : effective.name;
}

/** The browser's `localStorage`, as far as profile scope needs it. */
export interface DeviceStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const DEVICE_KEY = 'caduceus.profile';
const PROFILE_PARAM = 'profile';

/** The profile last chosen on this device, if any. */
export function deviceChoice(store: DeviceStore): string | undefined {
  return store.getItem(DEVICE_KEY) ?? undefined;
}

/** This device's last-used profile, for tabs opened later. */
export function rememberDeviceChoice(store: DeviceStore, name: string): void {
  store.setItem(DEVICE_KEY, name);
}

/**
 * Choosing a profile in one tab: the new query string for that tab's URL, and this device remembers the choice for
 * tabs opened later. `all` (cross-profile screens) clears the parameter. Other tabs and devices, and Hermes's own
 * default, are untouched.
 */
export function chooseProfile({ name, search, store }: { name: string; search: string; store: DeviceStore }): string {
  const query = new URLSearchParams(search);
  if (name === 'all') {
    query.delete(PROFILE_PARAM);
  } else {
    query.set(PROFILE_PARAM, name);
    rememberDeviceChoice(store, name);
  }
  const text = query.toString();
  return text ? `?${text}` : '';
}

/** A link target inside a tab: carries the tab's `?profile=` along unless the link names a profile itself. */
export function withProfile(to: string, urlProfile: string | undefined): string {
  if (urlProfile === undefined) return to;
  const [path, search = ''] = to.split('?');
  const query = new URLSearchParams(search);
  if (!query.has(PROFILE_PARAM)) query.set(PROFILE_PARAM, urlProfile);
  return `${path}?${query}`;
}

/** What the profile chip and switcher show about a Hermes profile. */
export interface ProfileSummary {
  name: string;
  model: string | null;
  gatewayRunning: boolean | null;
}

export interface HermesProfiles {
  profiles: ProfileSummary[];
  /** Hermes's sticky default (`hermes profile use`), the last fallback of the effective profile. */
  hermesDefault: string;
}

const record = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {});

/**
 * Reads the profiles and Hermes's default through the Caduceus proxy. Only GETs: nothing here can write Hermes.
 * Hermes declares no response schema for these two routes (the pin types them `unknown`), so the bodies are read
 * defensively.
 */
export async function loadProfiles(get: (route: '/api/profiles' | '/api/profiles/active') => Promise<unknown>): Promise<HermesProfiles> {
  const listed = record(await get('/api/profiles')).profiles;
  const profiles = (Array.isArray(listed) ? listed : []).flatMap((entry): ProfileSummary[] => {
    const { name, model, gateway_running } = record(entry);
    if (typeof name !== 'string') return [];
    return [{ name, model: typeof model === 'string' ? model : null, gatewayRunning: typeof gateway_running === 'boolean' ? gateway_running : null }];
  });
  // An older or stubbed Hermes may not answer this route; `default` always exists on a real one.
  const active = record(await get('/api/profiles/active').catch(() => undefined)).active;
  const hermesDefault = typeof active === 'string' && profiles.some((p) => p.name === active) ? active : 'default';
  return { profiles, hermesDefault };
}
