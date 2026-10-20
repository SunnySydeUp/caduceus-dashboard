// Throwaway smoke server for M4 #13: Caduceus in front of a real Hermes in a temp HERMES_HOME with a Mixture-of-Agents preset, a fallback chain
// (one entry turned off, one with an endpoint), usage rows and a models.dev cache. Run from the repo root: PORT=9250 npx tsx .scratch/m4-agents/m4-13-smoke/serve.ts
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startCaduceusServer } from '../../../server/src/caduceus-server.ts';
import { launchTestHermes } from '../../../server/test/fixtures/real-hermes.ts';
import { ownerCookie } from '../../../server/test/fixtures/owner.ts';
import { seedUsage } from '../../../server/test/fixtures/seed-session.ts';

const hermes = await launchTestHermes();
fs.writeFileSync(
  path.join(hermes.home, 'models_dev_cache.json'),
  JSON.stringify({ anthropic: { id: 'anthropic', name: 'Anthropic', env: ['ANTHROPIC_API_KEY'], models: { 'claude-opus-5': { id: 'claude-opus-5', family: 'claude-opus', attachment: true, reasoning: true, tool_call: true, modalities: { input: ['text', 'image'], output: ['text'] }, limit: { context: 1_000_000, output: 128_000 } } } } }),
);
await hermes.backend.ready();
const call = async (method: string, route: string, body?: unknown) => {
  const res = await hermes.backend.fetch(route, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${route}: ${res.status} ${text}`);
  return text ? JSON.parse(text) : undefined;
};
await call('PUT', '/api/model/moa', {
  default_preset: 'deep',
  presets: {
    default: { reference_models: [{ provider: 'anthropic', model: 'claude-opus-5' }], aggregator: { provider: 'anthropic', model: 'claude-sonnet-5' }, enabled: true },
    deep: {
      reference_models: [{ provider: 'anthropic', model: 'claude-opus-5' }, { provider: 'openrouter', model: 'deepseek/deepseek-v4-pro', enabled: false }],
      aggregator: { provider: 'anthropic', model: 'claude-sonnet-5' },
      reference_temperature: 0.5,
      fanout: 'every_n:3',
      enabled: true,
    },
  },
});
await call('PUT', '/api/config', {
  config: {
    fallback_providers: [{ provider: 'anthropic', model: 'claude-sonnet-5' }, { provider: 'openrouter', model: 'deepseek/deepseek-v4-pro', base_url: 'https://gateway.example.test/v1/with/a/very/long/path/that/must/wrap/on/a/phone' }],
    fallback_providers_disabled: [{ provider: 'zai', model: 'glm-5' }],
    agent: { api_max_retries: 2 },
  },
});
seedUsage(hermes.home, [
  { id: 's-opus', model: 'claude-opus-5', provider: 'anthropic', inputTokens: 120_000, outputTokens: 18_000, apiCalls: 41, estimatedCost: 2.31 },
  { id: 's-billed', model: 'gpt-5.5', provider: 'openai-codex', inputTokens: 30_000, outputTokens: 4_000, apiCalls: 12, estimatedCost: 0.2, actualCost: 0.41 },
  { id: 's-local', model: 'qwen3-8b-q4', provider: 'llamacpp', inputTokens: 5_000, outputTokens: 900, apiCalls: 7 },
  { id: 's-old', model: 'claude-haiku-4-5-20251001', provider: 'anthropic', inputTokens: 9_000, outputTokens: 1_000, apiCalls: 3, estimatedCost: 0.03, daysOld: 20 },
]);

const server = await startCaduceusServer({
  backend: hermes.backend,
  hermesRoot: hermes.home,
  port: Number(process.env.PORT ?? 9250),
  webRoot: fileURLToPath(new URL('../../../web/dist', import.meta.url)),
  hermesInstallDir: hermes.install.dir,
});
const cookie = await ownerCookie(server.url);
fs.writeFileSync('/tmp/caduceus-m4-13-cookie', cookie, { mode: 0o600 });
// Passkeys only work at `localhost`: open http://localhost:<port>, add a passkey in Settings with a virtual authenticator, then T3 saves can be confirmed.
console.log(`READY ${server.url} ${process.pid}`);
process.once('SIGINT', async () => {
  await server.close();
  await hermes.stop();
  fs.rmSync('/tmp/caduceus-m4-13-cookie', { force: true });
  process.exit(0);
});
