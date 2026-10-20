// Raises and clears the restart-to-apply banners (`../restart-to-apply.ts`) while the shell is mounted: one for each profile whose
// gateway has a change waiting that only a restart applies. The Caduceus server decides when one is done (the gateway has started
// since the change), so this asks again whenever a gateway may have started: a Hermes event, a module raising one, the tab returning.
import { useEffect, useRef } from 'react';
import { useGatewayEvent, useLiveLoad } from '../gateway.ts';
import { runGatewayAction } from '../gateway-actions.ts';
import { fetchGatewayFacts, onRestartRaised, restartBanner } from '../restart-to-apply.ts';
import { clearBanner, setBanner } from './banners.ts';
import { toast } from './toasts.ts';

/** Where the banner sits among the others: under a lost connection and a read-only notice, over the nudges. */
const PRIORITY = 4;

/** Hermes's answer to whether a profile's gateway is running; a gateway that cannot be asked about is taken as running (the restart is the safer offer). */
async function isRunning(profile: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/status?profile=${encodeURIComponent(profile)}`);
    return res.ok ? ((await res.json()) as { gateway_running?: boolean }).gateway_running !== false : true;
  } catch {
    return true;
  }
}

export function useRestartBanners(): void {
  /** The banners on show now, so that one that is no longer pending can be cleared. */
  const shown = useRef(new Set<string>());
  /** Which ask is the latest: an answer that arrives late must not undo a newer one. */
  const latest = useRef(0);
  const refresh = useRef<() => Promise<void>>(undefined);
  refresh.current = async () => {
    const ask = ++latest.current;
    const facts = await fetchGatewayFacts();
    if (!facts || ask !== latest.current) return;
    const running = await Promise.all(facts.pending.map((entry) => isRunning(entry.profile)));
    if (ask !== latest.current) return;
    const current = new Set<string>();
    facts.pending.forEach((entry, index) => {
      const banner = restartBanner(entry, { running: running[index] });
      current.add(banner.id);
      setBanner({
        id: banner.id,
        priority: PRIORITY,
        tone: 'warning',
        icon: 'refresh',
        title: banner.title,
        body: banner.body,
        actions: [
          {
            label: banner.action === 'restart' ? 'Restart gateway' : 'Start gateway',
            onClick: () =>
              void runGatewayAction(banner.action, entry.profile).then((outcome) => {
                if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
                else if (outcome.kind === 'done') toast(`${banner.action === 'restart' ? 'Restarting' : 'Starting'} the gateway of ${entry.profile}`, { detail: 'This notice goes when it is back.' });
              }),
          },
          { label: 'Open Gateway', to: `/connect/gateway` },
        ],
      });
    });
    for (const id of shown.current) if (!current.has(id)) clearBanner(id);
    shown.current = current;
  };

  useLiveLoad(() => void refresh.current?.());
  // `platforms.changed` is Hermes saying gateway_state.json moved: a gateway started, stopped or connected a channel.
  useGatewayEvent('platforms.changed', () => void refresh.current?.());
  useEffect(() => onRestartRaised(() => void refresh.current?.()), []);
  useEffect(() => {
    const visible = () => document.visibilityState === 'visible' && void refresh.current?.();
    document.addEventListener('visibilitychange', visible);
    return () => {
      document.removeEventListener('visibilitychange', visible);
      latest.current++;
      for (const id of shown.current) clearBanner(id);
      shown.current = new Set();
    };
  }, []);
}
