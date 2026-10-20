import { describe, expect, test } from 'vitest';
import { parseProductionConfig, renderProductionConfig } from '../src/production-config.ts';

// The production configuration of ticket 13 (a pure module): what the setup command writes and the server reads, and what
// it refuses to start with.
const HOST = 'my-mac.tail0000aa.ts.net';
const VALID = { port: 9130, publicOrigin: `https://${HOST}:9443`, rpId: HOST, tailnetOwners: ['owner@example.com'] };

describe('production config', () => {
  test('reads the port, origin, RP ID and owner logins; logins are kept lower-case and once; the rendered file reads back the same', () => {
    const config = parseProductionConfig(JSON.stringify({ ...VALID, tailnetOwners: ['Owner@Example.com', ' second@example.com ', 'owner@example.com'] }));

    expect(config).toEqual({ ...VALID, tailnetOwners: ['owner@example.com', 'second@example.com'] });
    expect(parseProductionConfig(renderProductionConfig(config))).toEqual(config);
    expect(renderProductionConfig(config).endsWith('\n')).toBe(true);
  });

  test('refuses a configuration the service must not start with, and says what is wrong', () => {
    const refused = (config: unknown) => {
      try {
        parseProductionConfig(typeof config === 'string' ? config : JSON.stringify(config));
        return 'accepted';
      } catch (error) {
        return (error as Error).message;
      }
    };

    expect({
      notJson: refused('{"port": '),
      notAnObject: refused('[]'),
      portZero: refused({ ...VALID, port: 0 }),
      portText: refused({ ...VALID, port: '9130' }),
      noOrigin: refused({ ...VALID, publicOrigin: undefined }),
      http: refused({ ...VALID, publicOrigin: `http://${HOST}:9443` }),
      path: refused({ ...VALID, publicOrigin: `https://${HOST}:9443/caduceus` }),
      notTailnet: refused({ ...VALID, publicOrigin: 'https://example.com:9443', rpId: 'example.com' }),
      funnelPort443: refused({ ...VALID, publicOrigin: `https://${HOST}` }),
      funnelPort8443: refused({ ...VALID, publicOrigin: `https://${HOST}:8443` }),
      funnelPort10000: refused({ ...VALID, publicOrigin: `https://${HOST}:10000` }),
      otherHost: refused({ ...VALID, rpId: 'other.tail0000aa.ts.net' }),
      noRpId: refused({ ...VALID, rpId: undefined }),
      noOwners: refused({ ...VALID, tailnetOwners: [] }),
      blankOwner: refused({ ...VALID, tailnetOwners: ['owner@example.com', '  '] }),
      ownerNotText: refused({ ...VALID, tailnetOwners: [42] }),
      typo: refused({ ...VALID, tailnetOwner: ['owner@example.com'] }),
    }).toEqual({
      notJson: 'The Caduceus configuration is not valid JSON.',
      notAnObject: 'The Caduceus configuration must be a JSON object.',
      portZero: '"port" must be a whole number from 1 to 65535.',
      portText: '"port" must be a whole number from 1 to 65535.',
      noOrigin: '"publicOrigin" must be the https origin Tailscale Serve exposes Caduceus at, like https://mac.tailnet.ts.net:9443.',
      http: '"publicOrigin" must be the https origin Tailscale Serve exposes Caduceus at, like https://mac.tailnet.ts.net:9443.',
      path: '"publicOrigin" must be the https origin Tailscale Serve exposes Caduceus at, like https://mac.tailnet.ts.net:9443.',
      notTailnet: '"publicOrigin" must be on a ts.net hostname: Caduceus is served only on the tailnet.',
      funnelPort443: '"publicOrigin" must not use port 443, 8443 or 10000: Funnel can publish those, and Caduceus must never be public.',
      funnelPort8443: '"publicOrigin" must not use port 443, 8443 or 10000: Funnel can publish those, and Caduceus must never be public.',
      funnelPort10000: '"publicOrigin" must not use port 443, 8443 or 10000: Funnel can publish those, and Caduceus must never be public.',
      otherHost: `"rpId" must be ${HOST}, the hostname of "publicOrigin": passkeys are bound to it.`,
      noRpId: `"rpId" must be ${HOST}, the hostname of "publicOrigin": passkeys are bound to it.`,
      noOwners: '"tailnetOwners" must list at least one Tailscale login: with none, nobody could reach Caduceus.',
      blankOwner: '"tailnetOwners" must be Tailscale logins, each written without spaces or commas.',
      ownerNotText: '"tailnetOwners" must be Tailscale logins, each written without spaces or commas.',
      typo: 'The Caduceus configuration has an unknown setting: "tailnetOwner".',
    });
  });
});
