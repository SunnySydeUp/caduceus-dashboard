// The production configuration (M0 #13): the one file `caduceus setup` writes and the service reads, so that where Caduceus is
// served and who may reach it are stated in one place rather than spread over environment variables.

export interface ProductionConfig {
  /** The loopback port Caduceus listens on, and the one Tailscale Serve forwards to. */
  port: number;
  /** The HTTPS origin Tailscale Serve exposes Caduceus at: `https://<node>.<tailnet>.ts.net:9443`. */
  publicOrigin: string;
  /** The WebAuthn RP ID every passkey is bound to: the ts.net hostname of `publicOrigin`, which must stay stable. */
  rpId: string;
  /** The Tailscale logins (`Tailscale-User-Login`) allowed through Serve, lower-case. */
  tailnetOwners: string[];
}

/** The configuration cannot be used; the message is meant for the owner, who reads it in the service log or the setup output. */
export class ProductionConfigError extends Error {}

/** The only ports Tailscale Funnel can publish on. Caduceus is never served on one of them. */
const FUNNEL_PORTS = [443, 8443, 10_000];

const SETTINGS: Record<string, true> = { port: true, publicOrigin: true, rpId: true, tailnetOwners: true };

/** Reads and checks the configuration file's text; throws `ProductionConfigError` for anything the service must not start with. */
export function parseProductionConfig(text: string): ProductionConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ProductionConfigError('The Caduceus configuration is not valid JSON.');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new ProductionConfigError('The Caduceus configuration must be a JSON object.');
  const unknownSetting = Object.keys(raw).find((key) => !Object.hasOwn(SETTINGS, key));
  if (unknownSetting) throw new ProductionConfigError(`The Caduceus configuration has an unknown setting: "${unknownSetting}".`);
  const { port, publicOrigin, rpId, tailnetOwners } = raw as Record<string, unknown>;

  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new ProductionConfigError('"port" must be a whole number from 1 to 65535.');
  }

  const origin = typeof publicOrigin === 'string' && URL.canParse(publicOrigin) ? new URL(publicOrigin) : undefined;
  // `origin` is the canonical form, so any difference (a path, a trailing slash, an upper-case host) is a mistake to name.
  if (!origin || origin.protocol !== 'https:' || origin.origin !== publicOrigin) {
    throw new ProductionConfigError('"publicOrigin" must be the https origin Tailscale Serve exposes Caduceus at, like https://mac.tailnet.ts.net:9443.');
  }
  if (!origin.hostname.endsWith('.ts.net')) throw new ProductionConfigError('"publicOrigin" must be on a ts.net hostname: Caduceus is served only on the tailnet.');
  if (FUNNEL_PORTS.includes(Number(origin.port || 443))) {
    throw new ProductionConfigError('"publicOrigin" must not use port 443, 8443 or 10000: Funnel can publish those, and Caduceus must never be public.');
  }
  if (rpId !== origin.hostname) {
    throw new ProductionConfigError(`"rpId" must be ${origin.hostname}, the hostname of "publicOrigin": passkeys are bound to it.`);
  }

  if (!Array.isArray(tailnetOwners) || tailnetOwners.length === 0) {
    throw new ProductionConfigError('"tailnetOwners" must list at least one Tailscale login: with none, nobody could reach Caduceus.');
  }
  const owners = tailnetOwners.map((login) => (typeof login === 'string' ? login.trim().toLowerCase() : ''));
  if (owners.some((login) => !/^[^\s,]+$/.test(login))) {
    throw new ProductionConfigError('"tailnetOwners" must be Tailscale logins, each written without spaces or commas.');
  }

  return { port, publicOrigin, rpId, tailnetOwners: [...new Set(owners)] };
}

/** The file's text for `config`: what `parseProductionConfig` reads back as the same configuration. */
export function renderProductionConfig(config: ProductionConfig): string {
  return `${JSON.stringify(config, null, 2)}\n`;
}
