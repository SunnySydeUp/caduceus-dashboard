import { describe, expect, test } from 'vitest';
import crypto from 'node:crypto';
import { encryptForPush, vapidAuthorization } from '../src/web-push.ts';
import { decryptPush } from './fixtures/push-stub.ts';

// Web Push as the standards write it (M2 #03): the message encryption of RFC 8291 and the VAPID header of RFC 8292. The expected bytes are the
// ones RFC 8291 §5 and Appendix A publish for the example below, so nothing here is derived from the code that is tested.
const b64 = (text: string) => Buffer.from(text, 'base64url');

const RFC = {
  plaintext: 'When I grow up, I want to be a watermelon',
  senderPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  receiverPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  receiverPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  body: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};

describe('message encryption (RFC 8291)', () => {
  test('encrypts the RFC example to the bytes the RFC publishes', () => {
    const body = encryptForPush({ p256dh: RFC.receiverPublic, auth: RFC.auth }, Buffer.from(RFC.plaintext), { senderPrivate: RFC.senderPrivate, salt: b64(RFC.salt) });

    expect(body.toString('base64url')).toBe(RFC.body);
  });

  test('a message with fresh keys and salt is not the same twice, and the receiver can read it', () => {
    const receiver = crypto.createECDH('prime256v1');
    receiver.generateKeys();
    const subscription = { p256dh: receiver.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') };

    const first = encryptForPush(subscription, Buffer.from('one'));
    const second = encryptForPush(subscription, Buffer.from('one'));

    expect(first.equals(second)).toBe(false);
    expect(decryptPush(first, receiver, subscription.auth)).toBe('one');
  });
});

describe('the VAPID header (RFC 8292)', () => {
  test('is a signed token for the push service, naming the sender, with the key it is signed by', () => {
    const keys = crypto.createECDH('prime256v1');
    keys.generateKeys();
    const publicKey = keys.getPublicKey().toString('base64url');
    const privateKey = keys.getPrivateKey().toString('base64url');

    const header = vapidAuthorization('https://push.example.net/push/JzLQ3raZJfFBR0aqvOMsLrt54w4rJUsV', { publicKey, privateKey }, 'mailto:owner@example.net', 1_700_000_000_000);

    const match = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(header);
    expect(match).not.toBeNull();
    const [, head, claims, signature, key] = match!;
    expect(key).toBe(publicKey);
    expect(JSON.parse(Buffer.from(head!, 'base64url').toString())).toEqual({ typ: 'JWT', alg: 'ES256' });
    // The audience is the push service's origin, and the token lives for twelve hours at most.
    expect(JSON.parse(Buffer.from(claims!, 'base64url').toString())).toEqual({ aud: 'https://push.example.net', exp: 1_700_000_000 + 12 * 3600, sub: 'mailto:owner@example.net' });
    const verifier = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: keys.getPublicKey().subarray(1, 33).toString('base64url'), y: keys.getPublicKey().subarray(33).toString('base64url') }, format: 'jwk' });
    expect(crypto.verify('sha256', Buffer.from(`${head}.${claims}`), { key: verifier, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature!, 'base64url'))).toBe(true);
  });
});
