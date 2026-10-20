// What the composer reads from and sends to Hermes outside the chat engine: its environment (which providers have a key) and saving a key.
// A key goes to Hermes and nowhere else: it is never kept here, and the environment Caduceus hands the page carries no value (the server
// takes Hermes's redacted preview out), so the page only ever learns whether a variable is set.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SetupRuntimeCheckResult } from '@caduceus/contracts/hermes/gateway';
import { gatewayConnection } from '../../gateway.ts';
import { fetchTiered } from '../../tiered.ts';
import { runTiered, type ActionOutcome } from '../profiles/profile-actions.ts';
import { parseEnv, type EnvVar } from './composer-model.ts';
import { execQuickCommandNames } from './slash-menu.ts';

const envPath = (profile: string) => `/api/env?profile=${encodeURIComponent(profile)}`;

/** Which of Hermes's environment variables are set for a profile; `undefined` until Hermes has answered (and when it cannot). */
export function useEnv(profile: string): { env: EnvVar[] | undefined; reload(): void } {
  const [env, setEnv] = useState<EnvVar[]>();
  const [count, setCount] = useState(0);
  const latest = useRef(0);
  useEffect(() => {
    const request = ++latest.current;
    setEnv(undefined);
    fetch(envPath(profile))
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((body: unknown) => request === latest.current && setEnv(parseEnv(body)))
      .catch(() => undefined);
  }, [profile, count]);
  return { env, reload: useCallback(() => setCount((n) => n + 1), []) };
}

/**
 * Hermes's strict word on one provider (`setup.runtime_check`): it resolves the credential as a session would, so a bridge or a sign-in counts. Asked only
 * when the environment shows no key (`provider` is then set). `settled` is false while Hermes is still answering; once true, `verdict` is its answer, or
 * `undefined` when it could not be asked.
 */
export function useRuntimeVerdict(profile: string, provider: string | undefined): { settled: boolean; verdict: SetupRuntimeCheckResult | undefined } {
  const [state, setState] = useState<{ settled: boolean; verdict: SetupRuntimeCheckResult | undefined }>({ settled: false, verdict: undefined });
  useEffect(() => {
    setState({ settled: false, verdict: undefined });
    if (!provider) return;
    let current = true;
    gatewayConnection()
      .client.request<SetupRuntimeCheckResult>('setup.runtime_check', { profile, provider })
      .then(
        (verdict) => current && setState({ settled: true, verdict }),
        () => current && setState({ settled: true, verdict: undefined }),
      );
    return () => {
      current = false;
    };
  }, [profile, provider]);
  return state;
}

/** Saves a provider's key in Hermes's environment (Tier 2: the owner confirms with a passkey). */
export function saveProviderKey(profile: string, provider: string, keyVar: string, key: string): Promise<ActionOutcome> {
  return runTiered(
    fetchTiered({
      method: 'PUT',
      path: envPath(profile),
      body: { key: keyVar, value: key },
      confirm: { title: `Save a key for ${provider}?`, text: `Hermes writes it to ${keyVar} in the profile’s environment. It is never shown again.`, object: keyVar, profile, confirmLabel: 'Save key' },
    }),
  );
}

/**
 * The names of the exec-type quick commands in a profile's config, which the slash menu switches off (the proxy refuses them whether or not it is told). `undefined` until
 * Hermes has answered; a config that cannot be read counts as none, since the proxy is what stops them.
 */
export function useExecQuickCommands(profile: string): ReadonlySet<string> | undefined {
  const [names, setNames] = useState<ReadonlySet<string>>();
  useEffect(() => {
    let current = true;
    setNames(undefined);
    fetch(`/api/config?profile=${encodeURIComponent(profile)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((body: unknown) => execQuickCommandNames(body), () => new Set<string>())
      .then((found) => current && setNames(found));
    return () => {
      current = false;
    };
  }, [profile]);
  return names;
}
