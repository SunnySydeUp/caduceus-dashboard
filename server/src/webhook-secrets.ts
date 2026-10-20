// What the browser may be told about a webhook subscription's secret (M5 #04). Hermes lists a subscription with `secret_set` and
// never its secret, and answers with the secret once, to the request that creates it. This is the second lock on the list: a field
// called `secret` is dropped before the list leaves Caduceus, so a Hermes that listed one by mistake would not reach a browser, a
// log or a cache with it. Caduceus keeps no secret itself, so there is nothing else to guard.
import { isRecord } from '@caduceus/contracts/policy/guards';

/** `body` (Hermes's list of webhooks) with the `secret` of every subscription removed. Anything else is left as it is. */
export function guardWebhookSecrets(body: unknown): unknown {
  if (!isRecord(body) || !Array.isArray(body.subscriptions)) return body;
  const subscriptions = body.subscriptions.map((subscription) => {
    if (!isRecord(subscription) || !('secret' in subscription)) return subscription;
    const { secret: _secret, ...rest } = subscription;
    return rest;
  });
  return { ...body, subscriptions };
}
