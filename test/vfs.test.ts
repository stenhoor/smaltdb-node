import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NodeVfs, NodeVfsError } from '../src/index.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'smaltdb-node-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** The id of a process that has exited. */
function deadPid(): number {
  const r = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))']);
  return Number(r.stdout.toString());
}

describe('NodeVfs files', () => {
  it('reads, writes, sizes, truncates and flushes at byte offsets, with short reads at the end', async () => {
    const vfs = new NodeVfs({ root: dir });
    const f = await vfs.open('a/b.db');
    expect(f.path).toBe(join(dir, 'a/b.db'));
    expect(f.size()).toBe(0);
    expect(f.write(new Uint8Array([1, 2, 3, 4]), 8)).toBe(4);
    expect(f.size()).toBe(12);
    const buf = new Uint8Array(6);
    expect(f.read(buf, 8)).toBe(4);
    expect([...buf]).toEqual([1, 2, 3, 4, 0, 0]);
    expect(f.read(buf, 0)).toBe(6);
    expect([...buf]).toEqual([0, 0, 0, 0, 0, 0]);
    f.truncate(10);
    expect(f.size()).toBe(10);
    f.flush();
    f.close();
    expect(() => f.size()).toThrow(/closed/);
    expect([...readFileSync(join(dir, 'a/b.db'))]).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 1, 2]);
  });

  it('create: false fails on a missing file with SMALT_CANTOPEN; exists and delete', async () => {
    const vfs = new NodeVfs({ root: dir });
    await expect(vfs.open('nope.db', { create: false })).rejects.toMatchObject({ code: 'SMALT_CANTOPEN' });
    expect(await vfs.exists('x.db')).toBe(false);
    (await vfs.open('x.db')).close();
    expect(await vfs.exists('x.db')).toBe(true);
    await vfs.delete('x.db');
    expect(await vfs.exists('x.db')).toBe(false);
    await vfs.delete('x.db'); // deleting a missing file is not an error
  });
});

describe('NodeVfs locks', () => {
  it('a file is open in one handle at a time: a second open fails with SMALT_BUSY until the first closes', async () => {
    const vfs = new NodeVfs({ root: dir });
    const a = await vfs.open('db');
    expect(readFileSync(join(dir, 'db.lock'), 'utf8')).toBe(String(process.pid));
    const err = await vfs.open('db').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NodeVfsError);
    expect(err).toMatchObject({ code: 'SMALT_BUSY', message: expect.stringMatching(/open in this process/) });
    a.close();
    expect(existsSync(join(dir, 'db.lock'))).toBe(false);
    (await vfs.open('db')).close();
  });

  it('shared handles (parallel readers) take no lock', async () => {
    const vfs = new NodeVfs({ root: dir });
    const a = await vfs.open('db', { shared: true });
    const b = await vfs.open('db', { shared: true });
    expect(existsSync(join(dir, 'db.lock'))).toBe(false);
    a.close();
    b.close();
  });

  it('a lock held by a running process is kept; one left by a process that is gone is taken over', async () => {
    const vfs = new NodeVfs({ root: dir });
    writeFileSync(join(dir, 'db.lock'), String(process.ppid));
    await expect(vfs.open('db')).rejects.toMatchObject({ code: 'SMALT_BUSY', message: expect.stringMatching(`process ${process.ppid}`) });
    writeFileSync(join(dir, 'db.lock'), String(deadPid()));
    const f = await vfs.open('db');
    expect(readFileSync(join(dir, 'db.lock'), 'utf8')).toBe(String(process.pid));
    f.close();
  });
});
