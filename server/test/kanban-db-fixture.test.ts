import { describe, expect, test } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { editKanbanDb } from './fixtures/kanban-db.ts';

// The one way tests write into Hermes's own kanban database (see the fixture): it must wait for a lock another process holds, as Hermes does in a
// transaction, instead of failing the test with "database is locked" (a flake that showed on a busy machine, in inbox-work.test.ts).
describe('editing the kanban database Hermes owns', () => {
  test('waits for the write lock another process holds, and then writes', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-kanban-db-'));
    try {
      const file = path.join(home, 'kanban.db');
      const setup = new DatabaseSync(file);
      setup.exec("PRAGMA journal_mode = WAL; CREATE TABLE tasks (id TEXT PRIMARY KEY, status TEXT); INSERT INTO tasks VALUES ('t1', 'ready')");
      setup.close();
      // Another process takes the write lock (as Hermes's `write_txn` does) and keeps it for a moment.
      const holder = spawn(process.execPath, ['--no-warnings', '-e', "const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync(process.argv[1]); db.exec('BEGIN IMMEDIATE'); console.log('locked'); setTimeout(() => { db.exec('COMMIT'); db.close(); }, 700);", file]);
      const exited = new Promise<void>((resolve) => holder.on('exit', () => resolve()));
      await new Promise<void>((resolve, reject) => {
        holder.once('error', reject);
        holder.stdout.on('data', (chunk: Buffer) => chunk.toString().includes('locked') && resolve());
      });

      const started = Date.now();
      editKanbanDb(home, (db) => db.prepare("UPDATE tasks SET status = 'blocked' WHERE id = 't1'").run());

      expect(Date.now() - started).toBeGreaterThanOrEqual(300);
      const check = new DatabaseSync(file, { readOnly: true });
      expect(check.prepare("SELECT status FROM tasks WHERE id = 't1'").get()).toEqual({ status: 'blocked' });
      check.close();
      await exited;
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
