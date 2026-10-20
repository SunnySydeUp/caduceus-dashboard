// What the Updates screen reads (M5 #12): Hermes's check, Caduceus's check, and Caduceus's state of the drain, the operation and What's New. Read again at
// every connect and when asked; nothing is kept between visits.
import { useCallback, useRef, useState } from 'react';
import type { UpdateCheck, UpdatesState } from '@caduceus/contracts/caduceus-api';
import { useLiveLoad } from '../../gateway.ts';
import { announceUpdatesChanged, fetchCaduceusCheck, fetchHermesCheck, fetchUpdatesState } from '../../updates.ts';

export interface UpdatesData {
  hermes?: UpdateCheck;
  caduceus?: UpdateCheck;
  state?: UpdatesState;
  /** A read is under way (the first, or a "Check now"). */
  loading: boolean;
  /** Reads again; `force` asks the sources afresh instead of taking what they cached. Tells the banners to read again too. */
  reload(force?: boolean): Promise<void>;
}

export function useUpdates(): UpdatesData {
  const [data, setData] = useState<Pick<UpdatesData, 'hermes' | 'caduceus' | 'state'>>({});
  const [loading, setLoading] = useState(true);
  const latest = useRef(0);
  const reload = useCallback(async (force = false) => {
    const ask = ++latest.current;
    setLoading(true);
    const [hermes, caduceus, state] = await Promise.all([fetchHermesCheck(force), fetchCaduceusCheck(force), fetchUpdatesState()]);
    if (ask !== latest.current) return;
    // A source that did not answer this time keeps what the screen showed: a moment of silence from Hermes is not an update that went away.
    setData((before) => ({ hermes: hermes ?? before.hermes, caduceus: caduceus ?? before.caduceus, state: state ?? before.state }));
    setLoading(false);
    announceUpdatesChanged();
  }, []);
  useLiveLoad(() => void reload());
  return { ...data, loading, reload };
}
