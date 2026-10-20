// The token of the Caduceus MCP server (M4 #11). The stdio server runs as the owner's own account, started by Hermes, and reads the token
// from a file only the owner can read next to Caduceus's store: so the registration command holds no secret, and nothing secret goes to
// the browser or into Hermes's config. The token is scoped: Caduceus accepts it only on the MCP tool route, never as a session.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const MCP_TOKEN_FILE = 'mcp-token';

/** Where the token of the Caduceus whose Hermes root home is `hermesRoot` is kept. */
export const mcpTokenPath = (hermesRoot: string): string => path.join(hermesRoot, 'caduceus', MCP_TOKEN_FILE);

export interface McpToken {
  /** Whether `header` (an `Authorization` value) carries the token. */
  accepts(header: string | undefined): boolean;
}

const digest = (value: string) => crypto.createHash('sha256').update(value).digest();

/** The token in `dir` (the store directory), made on first use, readable by the owner only. */
export function openMcpToken(dir: string): McpToken {
  const file = path.join(dir, MCP_TOKEN_FILE);
  if (!fs.existsSync(file)) fs.writeFileSync(file, `${crypto.randomBytes(32).toString('hex')}\n`, { mode: 0o600 });
  // A restored backup comes back with default modes.
  fs.chmodSync(file, 0o600);
  const expected = digest(`Bearer ${fs.readFileSync(file, 'utf8').trim()}`);
  return { accepts: (header) => header !== undefined && crypto.timingSafeEqual(digest(header), expected) };
}
