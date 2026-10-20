import { describe, expect, test } from 'vitest';
import { readPromptInput, secretIn, secretInAttachment } from '@caduceus/contracts/chat-drafts';

// What Caduceus will not keep in a draft or a saved prompt (M1 #11): secrets by what they look like. The rule has to catch what ends up in a store that is in
// every backup, and not refuse what a developer writes every day.
describe('secretIn', () => {
  test.each([
    ['an API key', 'export OPENAI_API_KEY=sk-live-3f9a8b7c6d5e4f3a2b1c', 'an API key or token'],
    ['a GitHub token', 'use ghp_abcdefghijklmnopqrstuvwxyz0123456789 for the clone', 'an API key or token'],
    ['an AWS key id', 'the id is AKIAABCDEFGHIJKLMNOP', 'an API key or token'],
    ['a JWT', 'Cookie eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U', 'an API key or token'],
    ['a private key block', '-----BEGIN RSA PRIVATE KEY-----\nMIIEow', 'a private key'],
    ['a bearer token', 'curl -H "Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345"', 'a bearer token'],
    ['a password in an address', 'git clone https://deploy:s3cretpass@example.com/repo.git', 'a password in an address'],
    ['a named password', 'password: hunter2hunter2', 'a password, key or token'],
    ['a quoted client secret', '{"client_secret": "abcd1234efgh5678"}', 'a password, key or token'],
    ['a named 40-digit hex key', 'GITHUB_TOKEN=0123456789abcdef0123456789abcdef01234567', 'a password, key or token'],
    ['a 64-digit hex digest', `key ${'ab12'.repeat(16)}`, 'an API key or token'],
  ])('%s is refused', (_name, text, what) => {
    expect(secretIn(text)).toBe(what);
  });

  test.each([
    'Explain how the API key and the access token are rotated, and where the password lives',
    'Key points: the introduction, the plan, and the risks',
    'Set the token limit to 4096 and the temperature to 0.2',
    'api_key=${OPENAI_API_KEY} is a reference, not a value',
    'git show 3f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f10 and compare it with HEAD~1',
    'The sk- prefix is how some providers name keys',
    'https://example.com/docs?page=2',
    'Ask me for the password of the staging box when we meet',
    '',
  ])('ordinary words are kept: %s', (text) => {
    expect(secretIn(text)).toBeUndefined();
  });
});

describe('secretInAttachment', () => {
  test('a file that is called like a credentials file is refused by its name, whatever it holds', () => {
    for (const name of ['.env', 'prod.env', '.env.local', 'server.pem', 'id_ed25519', 'credentials', 'secrets.yaml', 'auth.json', 'notes/.npmrc']) {
      expect(secretInAttachment(name, undefined), name).toContain(name.split('/').pop());
    }
    for (const name of ['notes.txt', 'environment.md', 'monkey.png', 'report.pdf', 'keynote.pdf', 'index.ts']) expect(secretInAttachment(name, undefined), name).toBeUndefined();
  });

  test('text that holds a secret is refused with the file named; binary data and images are not read', () => {
    const text = (words: string) => new TextEncoder().encode(words);
    expect(secretInAttachment('deploy.sh', text('export TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789'))).toBe('an API key or token in deploy.sh');
    expect(secretInAttachment('deploy.sh', text('echo hello'))).toBeUndefined();
    expect(secretInAttachment('data.bin', Uint8Array.from([0, 1, 2, ...text('ghp_abcdefghijklmnopqrstuvwxyz0123456789')]))).toBeUndefined();
    expect(secretInAttachment('shot.png', undefined)).toBeUndefined();
  });
});

describe('readPromptInput', () => {
  test('tidies a prompt and refuses what is not one', () => {
    expect(readPromptInput({ name: ' A  b ', text: 'Hi', tags: ['X', 'x'], profile: null })).toEqual({ name: 'A b', text: 'Hi', tags: ['x'], profile: null });
    for (const bad of [null, [], {}, { name: 'a', text: 'b', tags: [] }, { name: 'a', text: ' ', tags: [], profile: null }, { name: 'a', text: 'b', tags: [1], profile: null }]) expect(readPromptInput(bad)).toBeUndefined();
  });
});
