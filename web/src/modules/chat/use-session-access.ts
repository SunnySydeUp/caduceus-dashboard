// Whether the open session may be continued (M1 #16), as the conversation screen needs it before it opens the chat: read from Hermes once the
// gateway is connected (a session this Hermes hosts is known only then), and again when the owner asks.
import { useEffect, useState } from 'react';
import { gatewayConnection, useGatewayStatus } from '../../gateway.ts';
import { readHermes } from './read-hermes.ts';
import { readAccess, type Access } from './session-access.ts';
import { readLineage, type Lineage } from './session-lineage.ts';

export interface SessionAccessState {
  /** Hermes has not answered yet: the chat is not opened until it has (it opens one way or the other). */
  pending: boolean;
  access: Access;
  /** Where the session came from, once known. */
  source: string | undefined;
  /** Asks Hermes again (the other process may have finished). */
  recheck(): void;
}

const CONTINUE: Access = { mode: 'continue' };

/** A new chat has no session to ask about, and one that cannot be read is treated as one that can be continued: Hermes refuses what it must. */
export function useSessionAccess(profile: string, storedId: string | undefined): SessionAccessState {
  const connected = useGatewayStatus().state === 'connected';
  const [asked, setAsked] = useState(0);
  const [answer, setAnswer] = useState<{ key: string; access: Access; source: string | undefined }>();
  const key = storedId === undefined ? undefined : `${profile}/${storedId}/${asked}`;
  useEffect(() => {
    if (key === undefined || storedId === undefined || !connected) return;
    let current = true;
    readAccess({ rest: readHermes, client: gatewayConnection().client }, { storedId, profile, now: Date.now() / 1000 }).then(
      ({ access, source }) => current && setAnswer({ key, access, source }),
      () => current && setAnswer({ key, access: CONTINUE, source: undefined }),
    );
    return () => {
      current = false;
    };
  }, [key, storedId, profile, connected]);
  const mine = answer?.key === key ? answer : undefined;
  return { pending: key !== undefined && mine === undefined, access: mine?.access ?? CONTINUE, source: mine?.source, recheck: () => setAsked((n) => n + 1) };
}

/** The segments of the open session's conversation; undefined until read, and for a session that has none to read. Read again when the session changes. */
export function useLineage(profile: string, storedId: string | undefined): Lineage | undefined {
  const [found, setFound] = useState<{ key: string; lineage: Lineage }>();
  const key = storedId === undefined ? undefined : `${profile}/${storedId}`;
  useEffect(() => {
    if (key === undefined || storedId === undefined) return;
    let current = true;
    readLineage(readHermes, { storedId, profile }).then(
      (lineage) => current && setFound({ key, lineage }),
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [key, storedId, profile]);
  return found?.key === key ? found?.lineage : undefined;
}
