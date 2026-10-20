// Runs Hermes as a child process and stops it when the Caduceus server goes away.
// The server keeps this process's stdin open; stdin closes whenever the server dies, however it dies
// (crash, SIGKILL), which is the only parent-death signal macOS offers.
// Usage: node hermes-watchdog.mjs <command> [...args]
import { spawn } from 'node:child_process';

const KILL_AFTER_MS = 5_000;
const [command, ...args] = process.argv.slice(2);
const child = spawn(command, args, { stdio: ['ignore', 'inherit', 'inherit'] });

const stopChild = (signal) => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill(signal);
  setTimeout(() => child.kill('SIGKILL'), KILL_AFTER_MS).unref();
};

process.stdin.on('end', () => stopChild('SIGTERM'));
process.stdin.resume();
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => stopChild(signal));

child.on('error', (error) => {
  process.stderr.write(`hermes-watchdog: ${error.message}\n`);
  process.exit(127);
});
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
