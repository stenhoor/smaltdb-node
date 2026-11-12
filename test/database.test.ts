import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { Database } from 'smaltdb/engine';
import { NodeVfs } from '../src/index.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'smaltdb-node-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

it('a database on disk keeps its rows across close and open, with its log and lock beside it', async () => {
  const vfs = new NodeVfs({ root: dir });
  const db = await Database.open(vfs, 'shop.db');
  db.exec("CREATE TABLE orders(id INTEGER PRIMARY KEY, region TEXT); INSERT INTO orders VALUES (1, 'north'), (2, 'south')");
  expect(existsSync(join(dir, 'shop.db-wal'))).toBe(true);
  expect(existsSync(join(dir, 'shop.db.lock'))).toBe(true);
  expect(readdirSync(dir).filter((f) => f.endsWith('.lock')).sort()).toEqual(['shop.db-spill.lock', 'shop.db-wal.lock', 'shop.db.lock']);
  db.close();
  expect(readdirSync(dir).filter((f) => f.endsWith('.lock'))).toEqual([]);

  const again = await Database.open(vfs, 'shop.db');
  expect(again.query('SELECT id, region FROM orders ORDER BY id').rows).toEqual([[1, 'north'], [2, 'south']]);
  again.close();
});

it('a second open of a database that is open fails with SMALT_BUSY', async () => {
  const vfs = new NodeVfs({ root: dir });
  const db = await Database.open(vfs, 'shop.db');
  await expect(Database.open(vfs, 'shop.db')).rejects.toMatchObject({ code: 'SMALT_BUSY' });
  db.close();
});

it('rows committed by a process that is killed are there when the database opens again, and its lock is taken over', async () => {
  // Another Node process (the built smaltdb, smaltql and this plugin's source, types stripped) commits rows and is
  // killed before it closes anything: no checkpoint, no unlock.
  const child = fileURLToPath(new URL('./helpers/commit-and-die.mjs', import.meta.url));
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', child, dir], { encoding: 'utf8' });
  expect(r.signal).toBe('SIGKILL');
  expect(r.stdout).toBe('committed\n');
  const pid = Number(readFileSync(join(dir, 'shop.db.lock'), 'utf8'));
  expect(pid).toBe(r.pid);

  const db = await Database.open(new NodeVfs({ root: dir }), 'shop.db');
  expect(db.query('SELECT count(*), sum(qty) FROM orders').rows).toEqual([[100, 5050]]);
  expect(Number(readFileSync(join(dir, 'shop.db.lock'), 'utf8'))).toBe(process.pid);
  db.close();
});
