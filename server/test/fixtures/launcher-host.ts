// Test fixture: a process that owns a Hermes backend, so tests can kill the owner outright.
// Usage: node launcher-host.ts <fake-hermes path> <fake state dir>   (run directly under Node, not tsx:
// a wrapper would make this a grandchild, and killing the wrapper would leave this owner alive).
// The backend's child process keeps this process alive until it is killed.
import { launchHermesBackend } from '../../src/hermes-backend.ts';

const backend = launchHermesBackend({
  command: process.execPath,
  args: [process.argv[2]],
  env: { FAKE_HERMES_STATE_DIR: process.argv[3] },
});
await backend.ready();
process.stdout.write('HOST_READY\n');
