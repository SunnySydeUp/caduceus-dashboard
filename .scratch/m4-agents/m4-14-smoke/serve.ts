// Throwaway smoke server for M4 #14: Caduceus in front of a real Hermes in a temp HERMES_HOME whose Hugging Face is a local fixture (a few KB per "model").
// Run from the repo root: PORT=9251 npx tsx .scratch/m4-agents/m4-14-smoke/serve.ts
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startCaduceusServer } from '../../../server/src/caduceus-server.ts';
import { startHuggingFaceFixture } from '../../../server/test/fixtures/huggingface-fixture.ts';
import { launchTestHermes } from '../../../server/test/fixtures/real-hermes.ts';
import { ownerCookie } from '../../../server/test/fixtures/owner.ts';

const hub = await startHuggingFaceFixture({ 'fixture/tiny-GGUF': { files: [{ path: 'tiny-Q4_K_M.gguf', bytes: 64 * 1024 }, { path: 'tiny-Q8_0.gguf', bytes: 128 * 1024 }], downloads: 1200, likes: 7 } });
const hermes = await launchTestHermes({ env: hub.env });
await hermes.backend.ready();
fs.mkdirSync(`${hermes.home}/models`, { recursive: true });
fs.writeFileSync(`${hermes.home}/models/already-here-Q4.gguf`, Buffer.alloc(2048, 0x2e));
const server = await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home, port: Number(process.env.PORT ?? 9251), webRoot: fileURLToPath(new URL('../../../web/dist', import.meta.url)), hermesInstallDir: hermes.install.dir });
fs.writeFileSync('/tmp/caduceus-m4-14-cookie', await ownerCookie(server.url), { mode: 0o600 });
console.log(`READY ${server.url} ${process.pid}`);
process.once('SIGINT', async () => {
  await server.close();
  await hermes.stop();
  await hub.close();
  fs.rmSync('/tmp/caduceus-m4-14-cookie', { force: true });
  process.exit(0);
});
