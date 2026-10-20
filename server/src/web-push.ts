// Web Push, written out (M2 #03): the message encryption of RFC 8291 (aes128gcm, RFC 8188), the VAPID token of RFC 8292 and the POST of RFC 8030. It uses
// only `node:crypto` and `fetch`, so a test can point it at a plain local endpoint instead of a push service.
import crypto from 'node:crypto';

/** What a browser's `PushSubscription.toJSON()` holds: where to POST, and the two secrets a message is encrypted with. */
export interface PushTarget {
  endpoint: string;
  /** The user agent's public key (uncompressed P-256 point), base64url. */
  p256dh: string;
  /** The authentication secret, base64url. */
  auth: string;
}

export interface VapidKeys {
  /** The application server's public key, an uncompressed P-256 point, base64url: what the page subscribes with. */
  publicKey: string;
  /** The private scalar, base64url. */
  privateKey: string;
}

const RECORD_SIZE = 4096;
/** The most plaintext one record holds: the record size less the header (86 octets), the padding delimiter and the GCM tag. */
export const MAX_PAYLOAD_BYTES = RECORD_SIZE - 86 - 1 - 16;

const hkdf = (key: Buffer, salt: Buffer, info: Buffer, length: number): Buffer => Buffer.from(crypto.hkdfSync('sha256', key, salt, info, length));

/**
 * The body of a push message to a subscription (RFC 8291 §3): one aes128gcm record behind its header. `fixed` pins the sender's key and the salt, which
 * is how the RFC's own example is reproduced; a real message has fresh ones.
 */
export function encryptForPush(target: Pick<PushTarget, 'p256dh' | 'auth'>, plaintext: Buffer, fixed?: { senderPrivate: string; salt: Buffer }): Buffer {
  if (plaintext.length > MAX_PAYLOAD_BYTES) throw new RangeError(`A push message holds at most ${MAX_PAYLOAD_BYTES} bytes.`);
  const sender = crypto.createECDH('prime256v1');
  if (fixed) sender.setPrivateKey(Buffer.from(fixed.senderPrivate, 'base64url'));
  else sender.generateKeys();
  const senderPublic = sender.getPublicKey();
  const receiverPublic = Buffer.from(target.p256dh, 'base64url');
  const salt = fixed?.salt ?? crypto.randomBytes(16);
  const secret = sender.computeSecret(receiverPublic);
  const ikm = hkdf(secret, Buffer.from(target.auth, 'base64url'), Buffer.concat([Buffer.from('WebPush: info\0'), receiverPublic, senderPublic]), 32);
  const cek = hkdf(ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12);
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  // The last (here the only) record ends with the padding delimiter 0x02.
  const sealed = Buffer.concat([cipher.update(Buffer.concat([plaintext, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header[20] = senderPublic.length;
  return Buffer.concat([header, senderPublic, sealed]);
}

/** A new application server key pair for VAPID. */
export function generateVapidKeys(): VapidKeys {
  const keys = crypto.createECDH('prime256v1');
  keys.generateKeys();
  return { publicKey: keys.getPublicKey().toString('base64url'), privateKey: keys.getPrivateKey().toString('base64url') };
}

const json = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

/** The `Authorization` header that tells the push service which application server sends (RFC 8292): a token valid for twelve hours, and the key to check it with. */
export function vapidAuthorization(endpoint: string, keys: VapidKeys, subject: string, now: number): string {
  const publicKey = Buffer.from(keys.publicKey, 'base64url');
  const signingKey = crypto.createPrivateKey({
    key: { kty: 'EC', crv: 'P-256', x: publicKey.subarray(1, 33).toString('base64url'), y: publicKey.subarray(33).toString('base64url'), d: keys.privateKey },
    format: 'jwk',
  });
  const unsigned = `${json({ typ: 'JWT', alg: 'ES256' })}.${json({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })}`;
  const signature = crypto.sign('sha256', Buffer.from(unsigned), { key: signingKey, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${unsigned}.${signature.toString('base64url')}, k=${keys.publicKey}`;
}

/** The hosts of the push services the browsers use (Chrome and Android, Firefox, Safari, Edge): exactly these, or a subdomain of the last two. */
const PUSH_SERVICE_HOSTS = ['fcm.googleapis.com', 'updates.push.services.mozilla.com'];
const PUSH_SERVICE_DOMAINS = ['push.apple.com', 'notify.windows.com'];

/**
 * Whether Caduceus may POST to an endpoint: HTTPS to a push service's own host, and nothing else, so that a subscription cannot aim the server at an
 * address of the attacker's or of the network. Plain HTTP to this Mac's loopback (the tests' stand-in service) only when `allowLoopback` is set.
 */
export function endpointAllowed(endpoint: string, allowLoopback = false): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.username !== '' || url.password !== '') return false;
  if (url.protocol === 'http:') return allowLoopback && (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]');
  return url.protocol === 'https:' && (PUSH_SERVICE_HOSTS.includes(url.hostname) || PUSH_SERVICE_DOMAINS.some((domain) => url.hostname.endsWith(`.${domain}`)));
}

export type PushOutcome = 'sent' | 'gone' | 'failed';

export interface PushOptions {
  keys: VapidKeys;
  subject: string;
  now: number;
  /** How long the push service keeps the message for a device that is off (seconds). */
  ttl: number;
  urgency: 'very-low' | 'low' | 'normal' | 'high';
  fetch?: typeof fetch;
  /** Tests only: the push service is a stand-in on this Mac's loopback. */
  allowLoopback?: boolean;
}

/** Sends one message. `gone`: the push service says the subscription is over (404, 410): it is to be forgotten. `failed`: anything else; it is not retried. */
export async function sendPush(target: PushTarget, payload: string, { keys, subject, now, ttl, urgency, fetch: send = fetch, allowLoopback }: PushOptions): Promise<PushOutcome> {
  if (!endpointAllowed(target.endpoint, allowLoopback)) return 'failed';
  try {
    const res = await send(target.endpoint, {
      method: 'POST',
      headers: {
        authorization: vapidAuthorization(target.endpoint, keys, subject, now),
        'content-encoding': 'aes128gcm',
        'content-type': 'application/octet-stream',
        ttl: String(ttl),
        urgency,
      },
      body: new Uint8Array(encryptForPush(target, Buffer.from(payload))),
      signal: AbortSignal.timeout(15_000),
    });
    await res.body?.cancel();
    if (res.status === 404 || res.status === 410) return 'gone';
    return res.ok ? 'sent' : 'failed';
  } catch {
    return 'failed';
  }
}
