// Log lines in the throwaway HERMES_HOME, written the way Hermes's own handlers write them (`logs/<file>`, one line per record, appended).
import fs from 'node:fs';
import path from 'node:path';

/** Appends `lines` to `<home>/logs/<name>` (made if there is none) and returns the file's path. `name` is the file's name on disk: `agent.log`. */
export function writeLog(home: string, name: string, lines: readonly string[]): string {
  const dir = path.join(home, 'logs');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.appendFileSync(file, lines.map((line) => `${line}\n`).join(''));
  return file;
}

/** A line as Hermes logs it: `2026-10-18 10:00:01,000 ERROR tools.terminal_tool: boom`. `second` is the second of the minute. */
export function logLine(second: number, level: 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL', logger: string, message: string): string {
  return `2026-10-18 10:00:${String(second).padStart(2, '0')},000 ${level} ${logger}: ${message}`;
}
