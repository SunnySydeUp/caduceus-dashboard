// The VAPID key pair (M2 #03): made the first time Caduceus starts, kept in `vapid.json` in the Caduceus data folder, readable by the owner only, and the
// same ever after, because a browser's push subscription is bound to the public key it was made with. Only the public half ever leaves the server.
import fs from 'node:fs';
import path from 'node:path';
import { isRecord } from '@caduceus/contracts/policy/guards';
import { generateVapidKeys, type VapidKeys } from './web-push.ts';

export function loadVapidKeys(dir: string): VapidKeys {
  const file = path.join(dir, 'vapid.json');
  try {
    const kept: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (isRecord(kept) && typeof kept.publicKey === 'string' && typeof kept.privateKey === 'string') {
      // A restored backup comes back with default modes.
      fs.chmodSync(file, 0o600);
      return { publicKey: kept.publicKey, privateKey: kept.privateKey };
    }
  } catch {
    // None yet (the first start), or one that cannot be read: a new pair is made. Subscriptions made with the old key are then refused by their push
    // services, and the next push to each removes it; its device subscribes again.
  }
  const keys = generateVapidKeys();
  fs.writeFileSync(file, JSON.stringify(keys), { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  return keys;
}
