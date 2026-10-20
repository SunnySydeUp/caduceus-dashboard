// Throwaway smoke server for M4 #09: Caduceus in front of a real Hermes in a temp HERMES_HOME that has learned something, has a wiki, a project folder,
// a context-engine plugin and a local stand-in for Honcho's sign-in. Run from the repo root: PORT=9250 npx tsx .scratch/m4-agents/m4-09-smoke/serve.ts
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startCaduceusServer } from '../../../server/src/caduceus-server.ts';
import { startHonchoOauthFixture } from '../../../server/test/fixtures/honcho-oauth-server.ts';
import { launchTestHermes } from '../../../server/test/fixtures/real-hermes.ts';
import { ownerCookie } from '../../../server/test/fixtures/owner.ts';

const honcho = await startHonchoOauthFixture();
const hermes = await launchTestHermes({ env: honcho.env });
await hermes.backend.ready();
const call = async (method: string, route: string, body?: unknown) => {
  const res = await hermes.backend.fetch(route, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${route}: ${res.status} ${text}`);
  return text ? JSON.parse(text) : undefined;
};
fs.writeFileSync(path.join(hermes.home, 'honcho.json'), '{}');
const skill = (name: string, related: string[] = []) => `---\nname: ${name}\ndescription: ${name} notes.\n${related.length ? `metadata:\n  hermes:\n    related_skills: [${related.join(', ')}]\n` : ''}---\n\n# ${name}\n\nSteps for ${name}.\n`;
for (const [name, related] of [['deploy-notes', ['staging-check']], ['staging-check', []], ['release-checklist', ['deploy-notes']]] as const) await call('POST', '/api/skills', { name, content: skill(name, [...related]), profile: 'default' });
fs.writeFileSync(path.join(hermes.home, 'skills', '.usage.json'), JSON.stringify({ 'deploy-notes': { created_by: 'agent', use_count: 5 }, 'staging-check': { use_count: 2 }, 'release-checklist': { created_by: 'learn', use_count: 0 } }));
fs.mkdirSync(path.join(hermes.home, 'memories'), { recursive: true });
fs.writeFileSync(path.join(hermes.home, 'memories', 'MEMORY.md'), 'Deploys go through staging first\n§\nThe billing key rotates monthly\n§\nRelease checklist lives in the wiki');
fs.writeFileSync(path.join(hermes.home, 'memories', 'USER.md'), 'Prefers short answers');

const wiki = fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-smoke-wiki-'));
fs.mkdirSync(path.join(wiki, 'concepts'));
fs.writeFileSync(path.join(wiki, 'index.md'), '# Wiki index\n\n- [[concepts/context]]\n- [[concepts/memory]]\n');
fs.writeFileSync(path.join(wiki, 'SCHEMA.md'), '# Schema\n\nPages have frontmatter.\n');
fs.writeFileSync(path.join(wiki, 'concepts', 'context.md'), '# Context\n\nWhat fits in a window.\n');
fs.writeFileSync(path.join(wiki, 'concepts', 'memory.md'), '# Memory\n\nWhat survives a session.\n');
execFileSync('hermes', ['config', 'set', 'skills.config.wiki.path', wiki], { env: { ...process.env, HERMES_HOME: hermes.home }, stdio: 'pipe' });

const project = fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-smoke-project-'));
fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: 'demo', scripts: { test: 'vitest', lint: 'eslint .' } }));
fs.writeFileSync(path.join(project, 'package-lock.json'), '{}');
fs.writeFileSync(path.join(project, 'AGENTS.md'), '# Rules\n\n1. Run the tests before you commit.\n2. Small commits.\n');

const plugin = path.join(hermes.home, 'plugins', 'fixture-engine');
fs.mkdirSync(plugin, { recursive: true });
fs.writeFileSync(path.join(plugin, 'plugin.yaml'), 'name: fixture-engine\nversion: 1.0.0\ndescription: A context engine for the smoke check.\n');
fs.writeFileSync(path.join(plugin, '__init__.py'), 'from agent.context_engine import ContextEngine\nclass FixtureEngine(ContextEngine):\n    @property\n    def name(self): return "fixture-engine"\n    def update_from_response(self, usage): pass\n    def should_compress(self, prompt_tokens=None): return False\n    def compress(self, messages, current_tokens=None, **kw): return messages\ndef register(ctx):\n    ctx.register_context_engine(FixtureEngine())\n');
await call('POST', '/api/dashboard/agent-plugins/fixture-engine/enable');
await hermes.backend.restart();

const server = await startCaduceusServer({
  backend: hermes.backend,
  hermesRoot: hermes.home,
  port: Number(process.env.PORT ?? 9250),
  webRoot: fileURLToPath(new URL('../../../web/dist', import.meta.url)),
  hermesInstallDir: hermes.install.dir,
});
fs.writeFileSync('/tmp/caduceus-m4-09-cookie', await ownerCookie(server.url), { mode: 0o600 });
console.log(`READY ${server.url} ${process.pid} project=${project} wiki=${wiki}`);
process.once('SIGINT', async () => {
  await server.close();
  await hermes.stop();
  await honcho.close();
  fs.rmSync('/tmp/caduceus-m4-09-cookie', { force: true });
  fs.rmSync(wiki, { recursive: true, force: true });
  fs.rmSync(project, { recursive: true, force: true });
  process.exit(0);
});
