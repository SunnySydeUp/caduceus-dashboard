// A stand-in for huggingface.co, for the tests of Agents › Models › Local models. Hermes downloads and searches models at a fixed
// address (`https://huggingface.co`), so the fixture is that address: a CONNECT proxy that Hermes is pointed at (`HTTPS_PROXY`), which
// hands `huggingface.co` to a local HTTPS server holding a self-signed certificate for it (`SSL_CERT_FILE`) and refuses every other
// host. Nothing leaves the machine, and no real model is ever fetched: a "model" here is a few kilobytes.
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

export interface FixtureRepo {
  /** The files of the repo and their sizes in bytes. */
  files: readonly { path: string; bytes: number }[];
  downloads?: number;
  likes?: number;
}

export interface HuggingFaceFixture {
  /** The environment that makes a Hermes started with it reach this fixture for huggingface.co and nothing else. */
  env: Record<string, string>;
  /** Hosts a program asked the proxy for and was refused (never `huggingface.co`). */
  refused: string[];
  /** The `resolve/main` paths that were fetched, one entry for each request. */
  fetched: string[];
  /** Holds every download half way until `release()`, so a test can look at a job that is running. Resolves when the first held request is waiting. */
  hold(): { reached: Promise<void>; release(): void };
  close(): Promise<void>;
}

/** The bytes of a fixture file: the same for every request, so a ranged download can be checked as a whole. */
export const fixtureBytes = (total: number): Buffer => {
  const bytes = Buffer.alloc(total, 0x2e);
  bytes.write('GGUF', 0, 'latin1');
  return bytes;
};

export async function startHuggingFaceFixture(repos: Record<string, FixtureRepo>): Promise<HuggingFaceFixture> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-hf-'));
  const certPath = path.join(dir, 'huggingface.pem');
  const keyPath = path.join(dir, 'huggingface.key');
  await run('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath, '-out', certPath, '-days', '2', '-subj', '/CN=huggingface.co', '-addext', 'subjectAltName=DNS:huggingface.co', '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'extendedKeyUsage=serverAuth']);

  const refused: string[] = [];
  const fetched: string[] = [];
  let held: { reached: PromiseWithResolvers<void>; release: PromiseWithResolvers<void> } | undefined;

  const server = https.createServer({ key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) }, async (req, res) => {
    const url = new URL(req.url ?? '/', 'https://huggingface.co');
    const json = (body: unknown) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === '/api/models') {
      const query = (url.searchParams.get('search') ?? '').toLowerCase();
      json(
        Object.entries(repos)
          .filter(([repo]) => repo.toLowerCase().includes(query))
          .map(([id, repo]) => ({ id, downloads: repo.downloads ?? 0, likes: repo.likes ?? 0, lastModified: '2026-10-01T00:00:00.000Z', gated: false })),
      );
      return;
    }
    const tree = /^\/api\/models\/(.+)\/tree\/main$/.exec(url.pathname);
    if (tree) {
      const repo = repos[decodeURIComponent(tree[1])];
      if (!repo) {
        res.writeHead(404).end();
        return;
      }
      json(repo.files.map((file) => ({ type: 'file', path: file.path, size: file.bytes })));
      return;
    }
    const resolve = /^\/([^/]+\/[^/]+)\/resolve\/main\/(.+)$/.exec(url.pathname);
    const file = resolve && repos[resolve[1]]?.files.find((candidate) => candidate.path === decodeURIComponent(resolve[2]));
    if (!file) {
      res.writeHead(404).end();
      return;
    }
    fetched.push(decodeURIComponent(resolve[2]));
    const bytes = fixtureBytes(file.bytes);
    const range = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range ?? '');
    const [start, end] = range ? [Number(range[1]), Math.min(Number(range[2]), file.bytes - 1)] : [0, file.bytes - 1];
    res.writeHead(range ? 206 : 200, { 'content-length': end - start + 1, ...(range ? { 'content-range': `bytes ${start}-${end}/${file.bytes}` } : {}) });
    const body = bytes.subarray(start, end + 1);
    if (held && body.length > 1) {
      // Half of the range now, the rest when the test lets go.
      const half = Math.floor(body.length / 2);
      res.write(body.subarray(0, half));
      held.reached.resolve();
      await held.release.promise;
      res.end(body.subarray(half));
    } else res.end(body);
  });
  await once(server.listen(0, '127.0.0.1'), 'listening');
  const tlsPort = (server.address() as net.AddressInfo).port;

  const proxy = http.createServer((_req, res) => res.writeHead(405).end());
  proxy.on('connect', (req, client, head) => {
    const host = (req.url ?? '').split(':')[0];
    if (host !== 'huggingface.co') {
      refused.push(host);
      client.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
      return;
    }
    const upstream = net.connect(tlsPort, '127.0.0.1', () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    upstream.on('error', () => client.destroy());
    client.on('error', () => upstream.destroy());
  });
  await once(proxy.listen(0, '127.0.0.1'), 'listening');
  const proxyUrl = `http://127.0.0.1:${(proxy.address() as net.AddressInfo).port}`;

  return {
    env: { HTTPS_PROXY: proxyUrl, https_proxy: proxyUrl, HTTP_PROXY: proxyUrl, http_proxy: proxyUrl, NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost', SSL_CERT_FILE: certPath, REQUESTS_CA_BUNDLE: certPath },
    refused,
    fetched,
    hold() {
      held = { reached: Promise.withResolvers<void>(), release: Promise.withResolvers<void>() };
      const current = held;
      return {
        reached: current.reached.promise,
        release: () => {
          held = undefined;
          current.release.resolve();
        },
      };
    },
    async close() {
      held?.release.resolve();
      proxy.closeAllConnections();
      server.closeAllConnections();
      await Promise.all([once(proxy.close(), 'close'), once(server.close(), 'close')]);
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
