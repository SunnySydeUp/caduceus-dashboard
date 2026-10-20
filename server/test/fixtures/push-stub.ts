// A stand-in push service for tests (M2 #03): a local HTTP endpoint that a subscription points at, and the user agent's half of Web Push, so that a
// test can read what Caduceus sent. Nothing here ever reaches a real push service. `subscribe()` makes a device's keys, as a browser's
// `pushManager.subscribe` would, and `next()` resolves with the next message sent to that device, decrypted.
import crypto from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { PushMessage, PushSubscriptionJson } from '@caduceus/contracts/push';

export interface PushedMessage {
  message: PushMessage;
  /** The headers Caduceus sent to the push service. */
  headers: http.IncomingHttpHeaders;
}

export interface StubDevice {
  subscription: PushSubscriptionJson;
  /** The next message sent to this device; it waits for one. */
  next(): Promise<PushedMessage>;
  /** How many messages reached this device so far. */
  readonly received: number;
  /** What the push service answers from now on (the real ones answer 410 for a subscription that is over). */
  answer(status: number): void;
}

export interface PushStub {
  subscribe(): StubDevice;
  close(): Promise<void>;
}

/** What a user agent does with a message (RFC 8291 §3.4 and RFC 8188), written out apart from the code under test. */
export function decryptPush(body: Buffer, receiver: crypto.ECDH, auth: string): string {
  const salt = body.subarray(0, 16);
  const idLength = body[20]!;
  const senderPublic = body.subarray(21, 21 + idLength);
  const ciphertext = body.subarray(21 + idLength);
  const secret = receiver.computeSecret(senderPublic);
  const hkdf = (key: Buffer, saltBytes: Buffer, info: Buffer, length: number) => Buffer.from(crypto.hkdfSync('sha256', key, saltBytes, info, length));
  const ikm = hkdf(secret, Buffer.from(auth, 'base64url'), Buffer.concat([Buffer.from('WebPush: info\0'), receiver.getPublicKey(), senderPublic]), 32);
  const cek = hkdf(ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12);
  const decipher = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
  const plain = Buffer.concat([decipher.update(ciphertext.subarray(0, ciphertext.length - 16)), decipher.final()]);
  return plain.subarray(0, plain.lastIndexOf(2)).toString();
}

export async function startPushStub(): Promise<PushStub> {
  const devices = new Map<string, { receiver: crypto.ECDH; auth: string; queue: PushedMessage[]; waiting: PromiseWithResolvers<PushedMessage>[]; received: number; status: number }>();
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const device = devices.get(req.url ?? '');
      if (!device) return void res.writeHead(404).end();
      if (device.status >= 400) return void res.writeHead(device.status).end();
      const message = JSON.parse(decryptPush(Buffer.concat(chunks), device.receiver, device.auth)) as PushMessage;
      device.received += 1;
      const pushed = { message, headers: req.headers };
      const waiter = device.waiting.shift();
      if (waiter) waiter.resolve(pushed);
      else device.queue.push(pushed);
      res.writeHead(201).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    subscribe() {
      const id = `/push/${crypto.randomBytes(8).toString('hex')}`;
      const receiver = crypto.createECDH('prime256v1');
      receiver.generateKeys();
      const auth = crypto.randomBytes(16).toString('base64url');
      const device = { receiver, auth, queue: [] as PushedMessage[], waiting: [] as PromiseWithResolvers<PushedMessage>[], received: 0, status: 201 };
      devices.set(id, device);
      return {
        subscription: { endpoint: `http://127.0.0.1:${port}${id}`, keys: { p256dh: receiver.getPublicKey().toString('base64url'), auth } },
        next() {
          const ready = device.queue.shift();
          if (ready) return Promise.resolve(ready);
          const waiter = Promise.withResolvers<PushedMessage>();
          device.waiting.push(waiter);
          return waiter.promise;
        },
        get received() {
          return device.received;
        },
        answer(status) {
          device.status = status;
        },
      };
    },
    close: () => new Promise<void>((resolve) => (server.closeAllConnections(), server.close(() => resolve()))),
  };
}
