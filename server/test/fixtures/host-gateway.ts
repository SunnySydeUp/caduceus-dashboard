// A stand-in for the one gateway that Hermes 0.22 runs per host and that serves every profile: it publishes the gateway's host record the way Hermes's own
// gateway does (`gateway/host_rendezvous.py`), from a live Python process, so Hermes reads a profile as served by it. Nothing but the record exists: no
// platform connects and no model is called.
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { hermesPython, hermesSourceRoot } from './seed-session.ts';

export interface HostGateway {
  /** Removes the record and ends the process. */
  stop(): Promise<void>;
}

/**
 * Publishes a gateway host record in `lockDir` (the directory the test Hermes mirrors the gateway role from: `LaunchOptions.sharedHostState`) for the profiles
 * `served`, owned by this Python process, and resolves once it is published. `home` is the root home of the Hermes under test.
 */
export async function startHostGateway(options: { lockDir: string; home: string; served: readonly string[] }): Promise<HostGateway> {
  const script = `
import json, sys
sys.path.insert(0, ${JSON.stringify(hermesSourceRoot())})
from gateway import host_rendezvous as rendezvous
outcome, _ = rendezvous.claim_host_lock(rendezvous.ROLE_GATEWAY)
assert outcome is rendezvous.HostLockOutcome.ACQUIRED, outcome
assert rendezvous.publish_record(rendezvous.ROLE_GATEWAY, profiles=json.loads(sys.argv[1]), home=sys.argv[2]) is not None
print('published', flush=True)
sys.stdin.read()
rendezvous.clear_record(rendezvous.ROLE_GATEWAY)
rendezvous.release_host_lock(rendezvous.ROLE_GATEWAY)
`;
  const child: ChildProcess = spawn(hermesPython(), ['-c', script, JSON.stringify(options.served), options.home], {
    env: { ...process.env, HERMES_HOME: options.home, HERMES_GATEWAY_LOCK_DIR: options.lockDir },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const published = Promise.withResolvers<void>();
  const lines = createInterface({ input: child.stdout! });
  lines.on('line', (line) => {
    if (line === 'published') published.resolve();
  });
  child.once('exit', (code) => published.reject(new Error(`The host gateway stand-in exited (${code}) before it published its record`)));
  await published.promise;
  return {
    async stop() {
      child.stdin!.end();
      if (child.exitCode === null) await once(child, 'exit');
      lines.close();
    },
  };
}
