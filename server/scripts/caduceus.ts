// `npm run caduceus -- <command>`: set up, remove, restart and check the background service (M0 #13). The logic is in
// `server/src/service-cli.ts`; this only hands it the real machine.
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { runCli } from '../src/service-cli.ts';

process.exitCode = await runCli(process.argv.slice(2), {
  env: process.env,
  home: os.homedir(),
  uid: process.getuid!(),
  platform: process.platform,
  nodePath: process.execPath,
  projectRoot: fileURLToPath(new URL('../..', import.meta.url)),
  stdout: (text) => process.stdout.write(text),
  stdin: process.stdin,
  interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
});
