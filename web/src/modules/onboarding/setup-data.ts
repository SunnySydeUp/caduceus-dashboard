// Reading what the wizard's checks are made of (M5 #16): Hermes's two readiness answers, the profile's gateway status, and what Caduceus knows of this page
// (how it is reached, whether it is installed, how many passkeys are enrolled). Every look asks again and nothing is kept beyond what the screen shows (D1).
// It looks again when the connection to Hermes changes, when Hermes says its platforms moved, and when the tab comes back into view (the owner has gone
// elsewhere to fix something and returns).
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AuthMethods } from '@caduceus/contracts/caduceus-api';
import { gatewayConnection, useGatewayEvent, useGatewayStatus } from '../../gateway.ts';
import { useInstallOffer } from '../../shell/install.ts';
import { fetchGatewayStatus } from '../profiles/profiles-data.ts';
import { setupChecks, type Connection, type SetupCheck } from './setup-checks.ts';
import { readSetup } from './setup-hermes.ts';

/** How this page reached Caduceus. `isSecureContext` is true for https and for localhost, which browsers treat as secure. */
function connectionOf(): Connection {
  return location.protocol === 'https:' ? 'https' : window.isSecureContext ? 'local' : 'insecure';
}

async function readPasskeyCount(): Promise<number | undefined> {
  const res = await fetch('/_caduceus/api/auth/methods').catch(() => undefined);
  if (!res?.ok) return undefined;
  const methods = (await res.json().catch(() => undefined)) as Partial<AuthMethods> | undefined;
  return methods?.passkeys?.count;
}

export interface SetupView {
  /** `undefined` until the first look has finished. They stay while a newer look is made. */
  checks: SetupCheck[] | undefined;
  /** A look is being made. */
  checking: boolean;
  /** Looks again now. */
  recheck(): Promise<void>;
}

/** The checks for a profile, kept current. */
export function useSetupChecks(profile: string): SetupView {
  const hermes = useGatewayStatus().state;
  const installed = useInstallOffer().settings === 'installed';
  const [checks, setChecks] = useState<SetupCheck[]>();
  const [checking, setChecking] = useState(false);
  /** Which look is the latest: an answer that arrives late must not replace a newer one. */
  const latest = useRef(0);

  const recheck = useCallback(async () => {
    const look = ++latest.current;
    setChecking(true);
    const reachable = gatewayConnection().status.state === 'connected';
    const [answers, gateway, passkeys] = await Promise.all([
      reachable ? readSetup(gatewayConnection().client, profile) : { status: undefined, runtime: undefined },
      fetchGatewayStatus(profile),
      readPasskeyCount(),
    ]);
    if (look !== latest.current) return;
    setChecks(setupChecks({ hermesReachable: reachable, ...answers, gateway: gateway === undefined ? undefined : { running: gateway.gateway_running === true }, connection: connectionOf(), installed, passkeys }));
    setChecking(false);
  }, [profile, installed]);

  useEffect(() => void recheck(), [recheck, hermes]);
  useGatewayEvent('platforms.changed', () => void recheck());
  useEffect(() => {
    const visible = () => document.visibilityState === 'visible' && void recheck();
    document.addEventListener('visibilitychange', visible);
    return () => document.removeEventListener('visibilitychange', visible);
  }, [recheck]);

  return { checks, checking, recheck };
}
