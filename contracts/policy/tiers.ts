// The risk tiers of the policy proxy (architecture §5), shared by the Caduceus server, which enforces them, and the
// web app, which mirrors them in its confirmation dialogs.

/** T0 undo toast · T1 confirm · T2 passkey step-up · T3 step-up and a typed confirmation · `denied` never reaches Hermes. */
export type Tier = 'T0' | 'T1' | 'T2' | 'T3' | 'denied';

/** The tiers that ask the owner for something. */
export type ConfirmedTier = 'T1' | 'T2' | 'T3';

const RANK: Record<Tier, number> = { T0: 0, T1: 1, T2: 2, T3: 3, denied: 4 };

/** The stricter of two tiers. */
export function stricter(a: Tier, b: Tier): Tier {
  return RANK[b] > RANK[a] ? b : a;
}

/** Why something is denied, as the error body says it. */
export type DeniedReason =
  | 'shell-exec'
  | 'cli-exec'
  | 'exec-quick-command'
  | 'exec-unverified'
  | 'slash-admin'
  | 'vault'
  | 'billing'
  | 'peer-groups'
  | 'bot-relay'
  | 'debug-upload'
  | 'frame-injection'
  | 'host-terminal'
  | 'host-hardware'
  | 'hermes-auth'
  | 'not-proxied'
  | 'not-used'
  | 'unclassified'
  | 'bad-path'
  | 'bad-frame'
  | 'bad-body'
  | 'protected-path'
  | 'persistence-path'
  | 'secret-path'
  | 'outside-roots';

/** How long a passkey step-up covers its session: 5 minutes. The server grants it; the web app only plans around it. */
export const STEP_UP_MS = 5 * 60 * 1000;

/** What the owner is told when a request is denied. */
export const DENIED_MESSAGES: Record<DeniedReason, string> = {
  'shell-exec': 'Running shell commands through Caduceus is not allowed. Shell access is the terminal, behind a passkey.',
  'cli-exec': 'Running Hermes command lines through Caduceus is not allowed. Use the screen that does that job.',
  'exec-quick-command': 'This is a Hermes quick command that runs a shell command. Caduceus does not run those.',
  'exec-unverified': 'Caduceus could not check whether this slash command runs a shell command, so it was not run.',
  'slash-admin': 'This slash command changes Hermes itself. Use the screen for it, which asks for the right confirmation.',
  vault: 'The Hermes vault (logins and payment details) is not available through Caduceus.',
  billing: 'Billing and subscription changes are not available through Caduceus. Make them on the provider’s own site.',
  'peer-groups': 'Peer groups (rooms shared with other gateways) are not available through Caduceus.',
  'bot-relay': 'Bot relay between gateways is not available through Caduceus.',
  'debug-upload': 'Uploading a debug bundle to Nous is not available through Caduceus.',
  'frame-injection': 'Hermes lets any signed-in client inject frames here, so Caduceus never uses it.',
  'host-terminal': 'Opening a terminal on the host is not available through Caduceus. Copy the command and run it yourself.',
  'host-hardware': 'This would use the microphone, speaker or clipboard of the Mac that runs Hermes, not your device.',
  'hermes-auth': 'Hermes’s own sign-in is not used. Caduceus signs the owner in.',
  'not-proxied': 'Caduceus does not forward this Hermes endpoint.',
  'not-used': 'Caduceus does not use this Hermes feature.',
  unclassified: 'Caduceus does not know this Hermes operation yet, so it is not forwarded.',
  'bad-path': 'The request path is not valid.',
  'bad-frame': 'The message is not a valid JSON-RPC request.',
  'bad-body': 'The request body is not valid JSON, so Caduceus cannot tell what the request does.',
  'protected-path': 'This file is protected: Hermes’s keys, its sign-in file and Caduceus’s own data are edited only on their own screens.',
  'persistence-path': 'This place runs code later (a shell start-up file, SSH, a launch agent, a git hook, or Hermes’s own hooks, scripts, skills and plugins), so files are never written there through Caduceus.',
  'secret-path': 'This holds keys, tokens or credentials. Caduceus never shows them in a file: Hermes’s own secrets are revealed only by the screen for them, behind your passkey.',
  'outside-roots': 'This path is outside the folders Caduceus lets Hermes write to.',
};

/** What the policy says about one thing Caduceus could forward to Hermes. */
export interface Policy {
  tier: Tier;
  /** It changes nothing, so read-only mode lets it through. */
  read: boolean;
  /** Set when `tier` is `denied`. */
  reason?: DeniedReason;
}

/** What the owner is told when a destructive session call names no profile (the policy proxy refuses it; the web app does not send it). */
export const PROFILE_REQUIRED_MESSAGE = 'Deleting sessions needs an explicit profile: this call named none, so it was not sent.';
