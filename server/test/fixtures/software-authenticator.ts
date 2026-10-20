// A software WebAuthn authenticator: the system-boundary stand-in for the browser and its passkey provider in tests.
// It answers the options the Caduceus server hands the browser with the responses a real platform authenticator
// would produce: a P-256 (ES256) key per credential, `none` attestation, discoverable credentials, user verification.
import crypto from 'node:crypto';

type Json = Record<string, unknown>;

/** The bits of the options JSON (`PublicKeyCredentialCreationOptionsJSON` / `...RequestOptionsJSON`) an authenticator reads. */
export interface CreationOptions {
  challenge: string;
  rp: { id?: string; name: string };
  user: { id: string; name: string };
  excludeCredentials?: { id: string }[];
}
export interface RequestOptions {
  challenge: string;
  rpId?: string;
  allowCredentials?: { id: string }[];
}

interface Credential {
  id: string;
  rpId: string;
  userHandle: string;
  privateKey: crypto.KeyObject;
  counter: number;
}

/** CBOR (RFC 8949), only what attestation objects and COSE keys need: integers, byte and text strings, maps. */
function cbor(value: unknown): Buffer {
  const head = (major: number, n: number) =>
    n < 24
      ? Buffer.from([(major << 5) | n])
      : n < 0x100
        ? Buffer.from([(major << 5) | 24, n])
        : Buffer.from([(major << 5) | 25, n >> 8, n & 0xff]);
  if (typeof value === 'number') return value >= 0 ? head(0, value) : head(1, -1 - value);
  if (Buffer.isBuffer(value)) return Buffer.concat([head(2, value.length), value]);
  if (typeof value === 'string') return Buffer.concat([head(3, Buffer.byteLength(value)), Buffer.from(value)]);
  if (value instanceof Map) return Buffer.concat([head(5, value.size), ...[...value].flatMap(([k, v]) => [cbor(k), cbor(v)])]);
  throw new Error(`cbor: unsupported value ${String(value)}`);
}

/** Authenticator data flags: user present, user verified, backup eligible, backed up, attested credential data. */
const FLAGS = { UP: 0x01, UV: 0x04, BE: 0x08, BS: 0x10, AT: 0x40 } as const;

export interface SoftwareAuthenticator {
  /** Answers `navigator.credentials.create()`: makes a new discoverable credential. */
  register(options: CreationOptions, origin: string): Json;
  /**
   * Answers `navigator.credentials.get()`. With no `allowCredentials` (discoverable sign-in), it uses the
   * credential `credentialId` names, or else the newest one for the RP.
   */
  assert(options: RequestOptions, origin: string, credentialId?: string): Json;
  /** IDs of the credentials it holds, oldest first. */
  readonly credentialIds: string[];
}

export function createSoftwareAuthenticator(): SoftwareAuthenticator {
  const credentials: Credential[] = [];

  // The fixed part of authenticator data: RP ID hash, flags, signature counter.
  const authDataHeader = (rpId: string, flags: number, counter: number) => {
    const counterBytes = Buffer.alloc(4);
    counterBytes.writeUInt32BE(counter);
    return Buffer.concat([crypto.createHash('sha256').update(rpId).digest(), Buffer.from([flags]), counterBytes]);
  };

  return {
    register(options, origin) {
      const rpId = options.rp.id ?? new URL(origin).hostname;
      const excluded = new Set((options.excludeCredentials ?? []).map((c) => c.id));
      if (credentials.some((c) => c.rpId === rpId && excluded.has(c.id))) throw new Error('InvalidStateError: credential excluded');
      const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
      const id = crypto.randomBytes(16);
      const jwk = publicKey.export({ format: 'jwk' });
      // COSE_Key: kty EC2 (2), alg ES256 (-7), crv P-256 (1), x, y.
      const coseKey = cbor(new Map<number, unknown>([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x!, 'base64url')], [-3, Buffer.from(jwk.y!, 'base64url')]]));
      const idLength = Buffer.alloc(2);
      idLength.writeUInt16BE(id.length);
      const authData = Buffer.concat([
        authDataHeader(rpId, FLAGS.UP | FLAGS.UV | FLAGS.BE | FLAGS.BS | FLAGS.AT, 0),
        Buffer.alloc(16), // AAGUID: none
        idLength,
        id,
        coseKey,
      ]);
      const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: options.challenge, origin, crossOrigin: false }));
      const attestationObject = cbor(new Map<string, unknown>([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]));
      credentials.push({ id: id.toString('base64url'), rpId, userHandle: options.user.id, privateKey, counter: 0 });
      return {
        id: id.toString('base64url'),
        rawId: id.toString('base64url'),
        type: 'public-key',
        response: {
          clientDataJSON: clientDataJSON.toString('base64url'),
          attestationObject: attestationObject.toString('base64url'),
          transports: ['internal', 'hybrid'],
        },
        clientExtensionResults: {},
        authenticatorAttachment: 'platform',
      };
    },

    assert(options, origin, credentialId) {
      const rpId = options.rpId ?? new URL(origin).hostname;
      const allowed = (options.allowCredentials ?? []).map((c) => c.id);
      const candidates = credentials.filter(
        (c) => c.rpId === rpId && (allowed.length === 0 || allowed.includes(c.id)) && (credentialId === undefined || c.id === credentialId),
      );
      const credential = candidates.at(-1);
      if (!credential) throw new Error('NotAllowedError: no matching credential');
      credential.counter += 1;
      const authData = authDataHeader(rpId, FLAGS.UP | FLAGS.UV | FLAGS.BE | FLAGS.BS, credential.counter);
      const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: options.challenge, origin, crossOrigin: false }));
      const signature = crypto.sign('sha256', Buffer.concat([authData, crypto.createHash('sha256').update(clientDataJSON).digest()]), credential.privateKey);
      return {
        id: credential.id,
        rawId: credential.id,
        type: 'public-key',
        response: {
          clientDataJSON: clientDataJSON.toString('base64url'),
          authenticatorData: authData.toString('base64url'),
          signature: signature.toString('base64url'),
          userHandle: credential.userHandle,
        },
        clientExtensionResults: {},
        authenticatorAttachment: 'platform',
      };
    },

    get credentialIds() {
      return credentials.map((c) => c.id);
    },
  };
}
