// Reading Hermes for Connect › Webhooks. Only GETs live here; every change goes through `webhook-actions.ts`. Every load asks Hermes
// again and nothing is kept beyond what the page shows (D1). Hermes lists no secret, so there is none to keep.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLiveLoad } from '../../gateway.ts';
import { parseWebhooks, webhooksListPath, type WebhookReceiver } from './webhooks-model.ts';

export interface WebhooksView {
  /** `undefined` until Hermes has answered. It stays while a newer answer is asked for. */
  receiver: WebhookReceiver | undefined;
  /** The last ask failed: Hermes did not answer. */
  failed: boolean;
  reload(): Promise<void>;
}

/**
 * Hermes's webhook receiver and subscriptions for `profile`. Hermes has no signal for them, so they load again at every
 * `gateway.ready` (the first connect, a reconnect, a Hermes restart) and when the tab comes back into view, and the page
 * asks again after each change it makes. There is no timer.
 */
export function useWebhooks(profile: string | undefined): WebhooksView {
  const [receiver, setReceiver] = useState<WebhookReceiver>();
  const [failed, setFailed] = useState(false);
  /** Which load is the latest: an answer that arrives late must not replace a newer one. */
  const latest = useRef(0);

  const reload = useCallback(async () => {
    if (!profile) return;
    const request = ++latest.current;
    try {
      const res = await fetch(webhooksListPath(profile));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const next = parseWebhooks(await res.json());
      if (request !== latest.current) return;
      setReceiver(next);
      setFailed(false);
    } catch {
      if (request === latest.current) setFailed(true);
    }
  }, [profile]);

  useEffect(() => {
    // Another profile has another receiver: the last one's must not show as this one's while it loads.
    setReceiver(undefined);
    void reload();
  }, [reload]);
  useLiveLoad(() => void reload());
  useEffect(() => {
    const visible = () => document.visibilityState === 'visible' && void reload();
    document.addEventListener('visibilitychange', visible);
    return () => document.removeEventListener('visibilitychange', visible);
  }, [reload]);

  return { receiver, failed, reload };
}
