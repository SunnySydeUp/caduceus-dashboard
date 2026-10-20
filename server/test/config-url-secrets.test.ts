import { describe, expect, test } from 'vitest';
import { CONFIG_SECRET_MASK, maskConfigSecrets, restoreMaskedSecrets } from '@caduceus/contracts/config-keys';
import { maskRawConfig } from '../src/config-raw.ts';

// A password inside an address (`postgres://user:pass@host/db`) is a credential whatever the key's name is. The page sees the address with the password masked,
// and sends it back that way; what Hermes then saves must still be the real one.
describe('a password in an address of the config', () => {
  const config = {
    database: { url: 'postgres://app:s3cret@db.internal/prod' },
    mcp_servers: { files: { args: ['--remote', 'https://bob:hunter2@files.example/x', '--verbose'] } },
    custom_providers: [{ name: 'p', base_url: 'https://carol:pw@models.example/v1' }],
    display: { skin: 'dark', docs: 'https://example.com/a@b' },
  };
  const masked = { ...config, database: { url: `postgres://app:${CONFIG_SECRET_MASK}@db.internal/prod` }, mcp_servers: { files: { args: ['--remote', `https://bob:${CONFIG_SECRET_MASK}@files.example/x`, '--verbose'] } }, custom_providers: [{ name: 'p', base_url: `https://carol:${CONFIG_SECRET_MASK}@models.example/v1` }] };

  test('is masked in a read, wherever the address is, and nothing else is', () => {
    expect(maskConfigSecrets(config)).toEqual(masked);
  });

  test('comes back as the real address when the page sends the masked one back, and a changed user or host keeps the new one', () => {
    const unresolved: string[] = [];
    expect(restoreMaskedSecrets(masked, config, unresolved)).toEqual(config);
    expect(unresolved).toEqual([]);
    const edited = { ...masked, database: { url: `postgres://app:${CONFIG_SECRET_MASK}@db2.internal/prod` } };
    expect(restoreMaskedSecrets(edited, config, [])).toMatchObject({ database: { url: 'postgres://app:s3cret@db2.internal/prod' } });
  });

  test('a mask with no password to stand for is reported and never written', () => {
    const unresolved: string[] = [];
    restoreMaskedSecrets({ database: { url: `postgres://app:${CONFIG_SECRET_MASK}@db/prod` } }, { database: { url: 'postgres://db/prod' } }, unresolved);
    expect(unresolved).toEqual(['database.url']);
  });

  test('is masked in the raw file too, in values and in comments', () => {
    const raw = 'database:\n  url: postgres://app:s3cret@db.internal/prod # keep\n  # old: postgres://app:oldpw@db/x\ndisplay:\n  skin: dark\n';
    const text = maskRawConfig(raw);
    expect(text).not.toMatch(/s3cret|oldpw/);
    expect(text).toContain(`postgres://app:${CONFIG_SECRET_MASK}@db.internal/prod`);
    expect(text).toContain('skin: dark');
  });
});
