import { describe, expect, test } from 'vitest';
import { safeNext } from '@caduceus/contracts/safe-next';
import { isSecretConfigKey } from '@caduceus/contracts/config-keys';

// Where a sign-in may send the owner next, and which config keys hold a credential: two small pure contracts the server and the web app share.
describe('the page a sign-in lands on', () => {
  const origin = 'https://mac.example:9443';

  test('is a path on this origin and nothing else, whatever a browser would strip from the address', () => {
    expect(
      [
        '/chat?x=1#top',
        '/',
        '/work/board',
        '//evil.example',
        '/\\evil.example',
        '/\t/evil.example',
        '/\n/evil.example',
        '/\r/evil.example',
        '/\u0000/evil.example',
        '/\u007f/x',
        '\t//evil.example',
        'https://evil.example',
        'javascript:alert(1)',
        'evil',
        '',
        undefined,
        null,
        '/%09/evil.example',
      ].map((next) => safeNext(next, origin)),
    ).toEqual(['/chat?x=1#top', '/', '/work/board', '/', '/', '/', '/', '/', '/', '/', '/', '/', '/', '/', '/', '/', '/', '/%09/evil.example']);
  });
});

describe('the config keys that hold a credential', () => {
  test('are found by what the last word of the name says, signing and encryption keys, passphrases and webhook addresses included, and a key that only names a key press is not', () => {
    expect(
      [
        'auxiliary.vision.api_key',
        'security.signing_key',
        'storage.encryption_key',
        'gateway.hmac_key',
        'vault.master_key',
        'ssh.passphrase',
        'db.passwd',
        'discord.webhook_url',
        'slack.webhook-url',
        'voice.record_key',
        'compression.threshold_tokens',
        'display.skin',
        'agent.max_turns',
      ].map(isSecretConfigKey),
    ).toEqual([true, true, true, true, true, true, true, true, true, false, false, false, false]);
  });
});
