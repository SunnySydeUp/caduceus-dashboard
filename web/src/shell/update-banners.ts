// Raises and clears the update banners (`../update-banners.ts`) while the shell is mounted: that an update is available for Hermes or Caduceus, and that
// Caduceus is draining. The checks are asked again whenever the page may have changed (a connect, the tab coming back, an update beginning or ending on
// this page); the drain also arrives as a gateway event of Caduceus's own, so every open tab hears it begin and end.
import { useEffect, useRef } from 'react';
import { DRAIN_EVENT, type DrainState } from '@caduceus/contracts/caduceus-api';
import type { GatewayEventName } from '@caduceus/contracts/hermes/shared/gateway';
import { gatewayConnection, useLiveLoad } from '../gateway.ts';
import { settled } from '../settled.ts';
import { drainBanner, drainStateOf, updateBanner } from '../update-banners.ts';
import { fetchCaduceusCheck, fetchHermesCheck, fetchUpdatesState, onUpdatesChanged } from '../updates.ts';
import { clearBanner, setBanner, type Banner } from './banners.ts';

const DRAIN_ID = 'drain';

export function useUpdateBanners(): void {
  /** The update banners on show now, so that one that is no longer true can be cleared. */
  const shown = useRef(new Set<string>());
  /** Which ask is the latest: an answer that arrives late must not undo a newer one. */
  const latest = useRef(0);
  const refresh = useRef<() => Promise<void>>(undefined);

  const applyDrain = (state: DrainState | undefined) => {
    const banner = state && drainBanner(state);
    if (banner) setBanner(banner);
    else clearBanner(DRAIN_ID);
  };

  refresh.current = async () => {
    const ask = ++latest.current;
    // Nothing on the first screen waits for the checks.
    await settled;
    const [hermes, caduceus, state] = await Promise.all([fetchHermesCheck(), fetchCaduceusCheck(), fetchUpdatesState()]);
    if (ask !== latest.current) return;
    const wanted = [hermes && updateBanner('Hermes', hermes), caduceus && updateBanner('Caduceus', caduceus)].filter((banner): banner is Banner => Boolean(banner));
    for (const banner of wanted) setBanner(banner);
    const ids = new Set(wanted.map((banner) => banner.id));
    for (const id of shown.current) if (!ids.has(id)) clearBanner(id);
    shown.current = ids;
    // A page that could not reach Caduceus knows nothing new about the drain: it keeps what it showed.
    if (state) applyDrain(state.drain);
  };

  useLiveLoad(() => void refresh.current?.());
  useEffect(() => onUpdatesChanged(() => void refresh.current?.()), []);
  // Caduceus's own event, not one of Hermes's typed names: the client delivers an event to whoever listens for its type.
  const drainEvent = DRAIN_EVENT as GatewayEventName;
  useEffect(() => gatewayConnection().client.on(drainEvent, (event) => applyDrain(drainStateOf(event.payload))), [drainEvent]);
  useEffect(() => {
    const visible = () => document.visibilityState === 'visible' && void refresh.current?.();
    document.addEventListener('visibilitychange', visible);
    return () => {
      document.removeEventListener('visibilitychange', visible);
      latest.current++;
      for (const id of [...shown.current, DRAIN_ID]) clearBanner(id);
      shown.current = new Set();
    };
  }, []);
}
