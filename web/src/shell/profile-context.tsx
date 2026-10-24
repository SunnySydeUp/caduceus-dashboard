import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRouter } from '@tanstack/react-router';
import { useBackend } from '../gateway.ts';
import { getHermes } from '../hermes-api.ts';
import { closeAllLayers } from '../overlays/layers.ts';
import {
  chooseProfile,
  deviceChoice,
  effectiveProfile,
  loadProfiles,
  profileScope,
  scopeMode,
  rememberDeviceChoice,
  type HermesProfiles,
  type ProfileSource,
  type ScopeMode,
} from '../profile-scope.ts';
import { useRegistry } from './registry-context.tsx';
import { useRouteInfo, useUrlProfile } from './navigation.tsx';
import { toast } from './toasts.ts';

export interface ProfileScopeState {
  /** Hermes's profiles and its default; `undefined` until Hermes has answered. */
  hermes: HermesProfiles | undefined;
  /** Hermes could not be asked for its profiles (it is restarting, or stopped). */
  unavailable: boolean;
  /** The profile this tab works on; `undefined` while it cannot be known yet. */
  effective: { name: string; source: ProfileSource } | undefined;
  /** What the current screen shows: `all`, or one profile's name. */
  scope: string | undefined;
  /** How the current screen takes the profile: one profile, cross-profile ("All profiles" is offered), or locked to All profiles. */
  mode: ScopeMode;
  /** Scopes this tab to a profile (or `all`) through its URL and remembers it on this device. Never writes Hermes. */
  choose(name: string): Promise<void>;
  /** Asks Hermes for its profiles and default again: after Profiles has created, renamed or deleted one, or changed the default. */
  reload(): void;
}

const ProfileScopeContext = createContext<ProfileScopeState | undefined>(undefined);

export function ProfileScopeProvider({ children }: { children: ReactNode }) {
  const registry = useRegistry();
  const router = useRouter();
  const { moduleId } = useRouteInfo();
  const urlProfile = useUrlProfile();
  const backendReady = useBackend().status?.state === 'ready';
  const [hermes, setHermes] = useState<HermesProfiles>();
  const [unavailable, setUnavailable] = useState(false);
  const [loadCount, setLoadCount] = useState(0);
  // This device's last choice as it was when the tab loaded: a choice made in another tab later does not move this one.
  const [lastChoice] = useState(() => deviceChoice(localStorage));
  const mode = scopeMode(moduleId === undefined ? undefined : registry.module(moduleId));

  useEffect(() => {
    if (!backendReady) return;
    let cancelled = false;
    loadProfiles(getHermes).then(
      (loaded) => {
        if (cancelled) return;
        setHermes(loaded);
        setUnavailable(false);
      },
      () => !cancelled && setUnavailable(true),
    );
    return () => {
      cancelled = true;
    };
  }, [backendReady, loadCount]);

  const knownEffective = useMemo(
    () => effectiveProfile({ urlProfile, deviceChoice: lastChoice, hermesDefault: hermes?.hermesDefault ?? 'default', profiles: hermes?.profiles.map((p) => p.name) }),
    [urlProfile, lastChoice, hermes],
  );
  // Until Hermes has answered, only a name the tab already holds is known; the fallback to Hermes's default is not.
  const effective = hermes || knownEffective.source !== 'hermes' ? knownEffective : undefined;

  // Opening a link with ?profile= counts as using that profile on this device, once Hermes has said the profile exists (a link to one it does not have is not remembered).
  useEffect(() => {
    if (hermes && effective?.source === 'url') rememberDeviceChoice(localStorage, effective.name);
  }, [effective, hermes]);

  const state = useMemo<ProfileScopeState>(
    () => ({
      hermes,
      unavailable,
      effective,
      scope: profileScope(effective, mode),
      mode,
      async choose(name) {
        const search = chooseProfile({ name, search: location.search, store: localStorage });
        await closeAllLayers();
        router.history.push(`${location.pathname}${search}`);
        toast(name === 'all' ? 'Showing all profiles' : `Switched this tab to ${name}`, { tone: 'info' });
      },
      reload: () => setLoadCount((count) => count + 1),
    }),
    [hermes, unavailable, effective, mode, router],
  );
  return <ProfileScopeContext value={state}>{children}</ProfileScopeContext>;
}

export function useProfileScope(): ProfileScopeState {
  const state = useContext(ProfileScopeContext);
  if (!state) throw new Error('useProfileScope needs a ProfileScopeProvider');
  return state;
}
