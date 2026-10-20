import { describe, expect, test } from 'vitest';
import { hideSecretArguments, isPublicSharePath, isSecretArgument, redactSecretValues, sharedRow } from '@caduceus/contracts/share-links';
import { EXPIRY_CHOICES, EXPIRY_IDS, shareLink } from '../src/modules/shares/shares-model.ts';

describe('share links', () => {
  test('every lifetime the server offers is a choice on the page, and a link is made from the server’s own address when it has one', () => {
    expect(EXPIRY_CHOICES.map((choice) => choice.id)).toEqual([...EXPIRY_IDS]);
    expect(shareLink({ path: '/share/abc', origin: 'https://mac.tail.ts.net:9443' }, 'http://127.0.0.1:9130')).toBe('https://mac.tail.ts.net:9443/share/abc');
    expect(shareLink({ path: '/share/abc' }, 'http://127.0.0.1:9130')).toBe('http://127.0.0.1:9130/share/abc');
  });

  test.each([
    ['api_key', true], ['apiKey', true], ['Authorization', true], ['password', true], ['access_token', true], ['sort_key', true], ['client-secret', true],
    ['query', false], ['path', false], ['command', false], ['url', false],
  ])('the argument %s is secret: %s', (name, secret) => {
    expect(isSecretArgument(name)).toBe(secret);
  });

  test('secret arguments are hidden at any depth, text that is not JSON is not shown at all, and a row keeps only the fields a snapshot keeps', () => {
    expect(JSON.parse(hideSecretArguments('{"q":"x","opts":[{"token":"t"}]}') as string)).toEqual({ q: 'x', opts: [{ token: '[hidden]' }] });
    expect(hideSecretArguments('curl -H "Authorization: Bearer x"')).toBe('[hidden]');
    const row = sharedRow({ id: 1, role: 'assistant', content: 'hi', session_id: 'secret-session', token_count: 5, tool_calls: [{ id: 'c', function: { name: 'f', arguments: '{"password":"p"}' } }] });
    expect(Object.keys(row).sort()).toEqual(['content', 'id', 'role', 'tool_calls']);
    expect(JSON.stringify(row)).not.toContain('"p"');
  });

  test('a secret that is only in the text is redacted too: tokens, keys, private keys, bearer headers, passwords in addresses and in assignments, in every field a snapshot keeps; ordinary text is untouched', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1rwW1gFWFOEjXk';
    const secrets = [
      'sk-proj-abcdefghijklmnopqrstuvwxyz0123456789',
      'sk-ant-api03-abcdefghijklmnopqrstuvwxyz-0123456789',
      'ghp_abcdefghijklmnopqrstuvwxyz0123456789',
      'github_pat_11ABCDEFG0abcdefghijklmnopqrstuvwxyz',
      // Built from two parts so secret scanners (GitHub push protection) do not take the fixture for a real Slack token.
      ['xoxb', '1234567890-abcdefghijklmnop'].join('-'),
      'AKIAIOSFODNN7EXAMPLE',
      'AIzaSyA-abcdefghijklmnopqrstuvwxyz01234',
      jwt,
    ];
    const text = (secret: string) => `before ${secret} after`;
    for (const secret of secrets) expect(redactSecretValues(text(secret))).toBe('before [redacted] after');
    expect(redactSecretValues('Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345')).toBe('Authorization: Bearer [redacted]');
    expect(redactSecretValues('-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXk\nAAAA\n-----END OPENSSH PRIVATE KEY-----')).toBe('[redacted]');
    expect(redactSecretValues('git clone https://alice:hunter2@github.com/x/y.git')).toBe('git clone https://[redacted]@github.com/x/y.git');
    expect(redactSecretValues('export OPENAI_API_KEY=abc123def456 && DB_PASSWORD: "p4ss w0rd" ok')).toBe('export OPENAI_API_KEY=[redacted] && DB_PASSWORD: [redacted] ok');

    const ordinary = 'Run `npm test` in /Users/me/project, then open https://example.com/a?b=1. The key idea: sort_key=name is a column. sk-learn is a library. See issue #1234567890.';
    expect(redactSecretValues(ordinary)).toBe(ordinary);

    const row = sharedRow({
      role: 'tool',
      content: `file says ${secrets[0]}`,
      reasoning: `thinking about ${secrets[2]}`,
      reasoning_content: secrets[7],
      tool_calls: [{ id: 'c', function: { name: 'sh', arguments: JSON.stringify({ command: `curl -u alice:x https://alice:pw@host/ -H "X: ${secrets[1]}"` }) } }],
    });
    expect(JSON.stringify(row)).not.toMatch(/sk-proj|ghp_|sk-ant|eyJhbGci|alice:pw/);
    expect(row.content).toBe('file says [redacted]');
  });

  test('only a path shaped like a token is public', () => {
    const token = 'a'.repeat(43);
    expect([`/share/${token}`, `/_caduceus/share/${token}`, '/share/short', `/share/${token}/x`, '/_caduceus/api/shares', '/home'].map(isPublicSharePath)).toEqual([true, true, false, false, false, false]);
  });
});
