// A stand-in for the `remindctl` command (Apple Reminders), for the tests of Today's reminders. It is a real executable, so the server runs it exactly as it runs
// the real one; what it prints, and whether it fails, is set by files in its own folder, and it writes down the arguments of every call so that a test can see
// that the command line is fixed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface FakeRemindctl {
  /** The executable's path. */
  command: string;
  /** What the next calls print (the JSON text `remindctl` prints). */
  prints(stdout: string): void;
  /** Makes the next calls print `stderr` and exit with `code`. */
  fails(code: number, stderr: string): void;
  /** The arguments of every call so far. */
  calls(): string[][];
  remove(): void;
}

const SCRIPT = `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const dir = __dirname;
fs.appendFileSync(path.join(dir, 'calls.jsonl'), JSON.stringify(process.argv.slice(2)) + '\\n');
const failure = path.join(dir, 'failure.json');
if (fs.existsSync(failure)) {
  const { code, stderr } = JSON.parse(fs.readFileSync(failure, 'utf8'));
  process.stderr.write(stderr);
  process.exit(code);
}
process.stdout.write(fs.readFileSync(path.join(dir, 'stdout.txt'), 'utf8'));
`;

/** Makes the fake in a folder of its own under the temp directory (`caduceus-remindctl-*`); the test removes it. */
export function makeFakeRemindctl(): FakeRemindctl {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-remindctl-'));
  const command = path.join(dir, 'remindctl');
  fs.writeFileSync(command, SCRIPT, { mode: 0o755 });
  fs.writeFileSync(path.join(dir, 'stdout.txt'), '[]');
  return {
    command,
    prints(stdout) {
      fs.rmSync(path.join(dir, 'failure.json'), { force: true });
      fs.writeFileSync(path.join(dir, 'stdout.txt'), stdout);
    },
    fails(code, stderr) {
      fs.writeFileSync(path.join(dir, 'failure.json'), JSON.stringify({ code, stderr }));
    },
    calls() {
      const file = path.join(dir, 'calls.jsonl');
      return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as string[]) : [];
    },
    remove() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
