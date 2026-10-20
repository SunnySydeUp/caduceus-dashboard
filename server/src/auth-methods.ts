// The extra sign-in methods of the owner (M5 #15), kept in the Caduceus store: whether each is on and how it is set up. Password and passkeys are the owner's own
// credentials (owner-auth.ts, passkeys.ts) and always remain; these two are additions that never replace them.
import type { CaduceusStore } from './caduceus-store.ts';

export interface OidcConfig {
  issuer: string;
  clientId: string;
  /** Empty for a public client (PKCE alone). */
  clientSecret: string;
  /** An email address (the provider must say it is verified) or the provider's subject: the only identity that may sign in. */
  allowedUser: string;
}

export interface TailscaleConfig {
  /** The tailnet login (lower case) that may sign in through Serve. */
  login: string;
}

export interface AuthMethodStore {
  oidc(): { enabled: boolean; config?: OidcConfig };
  tailscale(): { enabled: boolean; config?: TailscaleConfig };
  setOidc(enabled: boolean, config: OidcConfig): void;
  setTailscale(enabled: boolean, config: TailscaleConfig): void;
}

export function createAuthMethodStore(store: CaduceusStore): AuthMethodStore {
  const { db } = store;
  const read = <T>(id: string): { enabled: boolean; config?: T } => {
    const row = db.prepare('SELECT enabled, config FROM auth_methods WHERE id = ?').get(id) as { enabled: number; config: string } | undefined;
    return row ? { enabled: row.enabled === 1, config: JSON.parse(row.config) as T } : { enabled: false };
  };
  const write = (id: string, enabled: boolean, config: object) =>
    void db.prepare('INSERT INTO auth_methods (id, enabled, config) VALUES (?, ?, ?) ON CONFLICT (id) DO UPDATE SET enabled = excluded.enabled, config = excluded.config').run(id, enabled ? 1 : 0, JSON.stringify(config));
  return {
    oidc: () => read<OidcConfig>('oidc'),
    tailscale: () => read<TailscaleConfig>('tailscale'),
    setOidc: (enabled, config) => write('oidc', enabled, config),
    setTailscale: (enabled, config) => write('tailscale', enabled, config),
  };
}
