// The wizard's first step (M5 #16): what Hermes says of itself (`setup.status`, the loose provider check, and `setup.runtime_check`, the strict one that
// resolves the model the way a new session would) and what Caduceus knows of its own side (how this page is reached, whether it is installed, whether a
// passkey is enrolled), as a list of pass/fail checks each with a link to where it is fixed. Pure: the page reads Hermes and the browser and passes the
// answers in. Nothing is kept: every look asks again.
import type { SetupRuntimeCheckResult, SetupStatusResult } from '@caduceus/contracts/hermes/gateway';

export type CheckId = 'hermes' | 'provider' | 'gateway' | 'https' | 'install' | 'passkey';

export interface SetupCheck {
  id: CheckId;
  label: string;
  state: 'pass' | 'fail';
  /** One sentence: what was found, in Hermes's own words where it gave some. */
  detail: string;
  /** `required` checks stop Caduceus being useful; `recommended` ones are advice, and the wizard never blocks on either. */
  need: 'required' | 'recommended';
  /** Where it is fixed. */
  fix?: { label: string; to: string };
}

/** How the page reached Caduceus: over HTTPS, from this Mac on localhost (a secure context), or over plain http from elsewhere. */
export type Connection = 'https' | 'local' | 'insecure';

export interface SetupInput {
  /** The page's gateway connection to Hermes is up. */
  hermesReachable: boolean;
  /** Hermes's loose check; `undefined` when it could not be asked. */
  status: SetupStatusResult | undefined;
  /** Hermes's strict check; `undefined` when it could not be asked. */
  runtime: SetupRuntimeCheckResult | undefined;
  /** What Hermes's status endpoint says of the profile's gateway; `undefined` when it did not answer. */
  gateway: { running: boolean } | undefined;
  connection: Connection;
  installed: boolean;
  /** How many passkeys the owner has enrolled; `undefined` when Caduceus could not read them. */
  passkeys: number | undefined;
}

function providerCheck({ hermesReachable, status, runtime }: SetupInput): Pick<SetupCheck, 'state' | 'detail'> {
  if (!hermesReachable || (status === undefined && runtime === undefined)) return { state: 'fail', detail: 'Hermes did not say whether a provider is configured.' };
  if (runtime?.ok === false) return { state: 'fail', detail: runtime.error || 'Hermes cannot serve the model it would use.' };
  if (runtime?.ok === true) {
    const where = `${runtime.provider || 'The provider'} is ready${runtime.model ? ` with ${runtime.model}` : ''}`;
    return { state: 'pass', detail: runtime.free_tier_route ? `${where}, on Hermes\u2019s free tier.` : `${where}.` };
  }
  if (status?.ok === false) return { state: 'fail', detail: status.error || 'Hermes did not accept the question.' };
  return status?.provider_configured ? { state: 'pass', detail: 'A provider is configured.' } : { state: 'fail', detail: 'No provider is configured yet.' };
}

/** The checks, in the order the wizard shows them. */
export function setupChecks(input: SetupInput): SetupCheck[] {
  const { hermesReachable, gateway, connection, installed, passkeys } = input;
  const provider = providerCheck(input);
  const gatewayDetail = gateway === undefined ? 'Hermes did not say whether the gateway is running.' : gateway.running ? 'The messaging gateway is running.' : 'The messaging gateway is not running. Chat works without it; Telegram and other channels need it.';
  return [
    {
      id: 'hermes',
      label: 'Hermes answers',
      state: hermesReachable ? 'pass' : 'fail',
      detail: hermesReachable ? 'Caduceus is connected to Hermes.' : 'Hermes is not answering. It may still be starting, or it may have stopped.',
      need: 'required',
      ...(hermesReachable ? {} : { fix: { label: 'Open Health', to: '/observe/health' } }),
    },
    { id: 'provider', label: 'A provider is set up', ...provider, need: 'required', ...(provider.state === 'pass' ? {} : { fix: { label: 'Add a provider key', to: '/system/keys' } }) },
    {
      id: 'gateway',
      label: 'The gateway is running',
      state: gateway?.running ? 'pass' : 'fail',
      detail: gatewayDetail,
      need: 'recommended',
      ...(gateway?.running ? {} : { fix: { label: 'Open Gateway', to: '/connect/gateway' } }),
    },
    {
      id: 'https',
      label: 'Reached over HTTPS',
      state: connection === 'insecure' ? 'fail' : 'pass',
      detail:
        connection === 'https'
          ? 'This page is served over HTTPS.'
          : connection === 'local'
            ? 'You are on the Mac that runs Caduceus, over localhost. A phone needs HTTPS to install the app and get notifications, for example through Tailscale Serve.'
            : 'This page is served over plain http. Browsers only install the app and allow notifications over HTTPS.',
      need: 'recommended',
      ...(connection === 'insecure' ? { fix: { label: 'Open Health', to: '/observe/health' } } : {}),
    },
    {
      id: 'install',
      label: 'Installed as an app',
      state: installed ? 'pass' : 'fail',
      detail: installed ? 'You are using the installed app.' : 'Caduceus is not installed on this device yet. Installed, it opens like an app and, on iPhone, can send notifications.',
      need: 'recommended',
      ...(installed ? {} : { fix: { label: 'Install Caduceus', to: '/settings/install' } }),
    },
    {
      id: 'passkey',
      label: 'A passkey is enrolled',
      state: passkeys !== undefined && passkeys > 0 ? 'pass' : 'fail',
      detail:
        passkeys === undefined ? 'Caduceus could not read your passkeys.' : passkeys > 0 ? `${passkeys === 1 ? '1 passkey is' : `${passkeys} passkeys are`} enrolled.` : 'No passkey yet. A passkey confirms the changes that need more than a click.',
      need: 'recommended',
      ...(passkeys !== undefined && passkeys > 0 ? {} : { fix: { label: 'Add a passkey', to: '/system/security' } }),
    },
  ];
}
