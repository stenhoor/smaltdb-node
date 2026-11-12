// Files on disk for smaltdb in Node.js: a `Vfs` over node:fs.
//
//   import { Database } from 'smaltdb/engine';
//   import { NodeVfs } from '@smaltworks/smaltdb-node';
//
//   const db = await Database.open(new NodeVfs({ root: 'data' }), 'orders.db');
//
// smaltdb opens a database's main file, its log (`<path>-wal`) and its scratch file (`<path>-spill`) through the VFS.
// In a browser, OPFS gives each open file to one handle at a time; Node has no such lock, so this VFS keeps one beside
// each file it opens (`<path>.lock`, holding the process id). A second open of the same file, from this process or
// another, fails with SMALT_BUSY while the first is open, as in OPFS. A lock left by a process that was killed is taken
// over. `flush` is fsync: a commit is on disk when smaltdb says it is.
//
// The plugin imports only types from smaltdb (smaltdb ADR 0012), so it never loads a second copy of the engine.

import { closeSync, existsSync, fstatSync, fsyncSync, ftruncateSync, mkdirSync, openSync, readFileSync, readSync, unlinkSync, writeSync, constants } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { OpenOptions, Vfs, VfsFile } from 'smaltdb/engine';

export interface NodeVfsOptions {
  /** The directory paths are relative to. Default: the process's working directory. */
  root?: string;
}

/** An error with smaltdb's codes: SMALT_CANTOPEN (no such file, or it can't be opened) and SMALT_BUSY (locked). */
export class NodeVfsError extends Error {
  readonly code: 'SMALT_CANTOPEN' | 'SMALT_BUSY';
  constructor(code: 'SMALT_CANTOPEN' | 'SMALT_BUSY', message: string) {
    super(message);
    this.name = 'SmaltError';
    this.code = code;
  }
}

/** Locks this process holds, so they are removed if it exits without closing its files. */
const held = new Set<string>();
let exitHook = false;

function hookExit() {
  if (exitHook) return;
  exitHook = true;
  process.once('exit', () => {
    for (const lock of held) {
      try {
        unlinkSync(lock);
      } catch {
        // already gone
      }
    }
  });
}

/** Whether a process with this id is running. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'; // running, but someone else's
  }
}

/** Takes the lock for a file, or throws SMALT_BUSY. A lock whose process is gone is taken over. */
function lock(path: string): string {
  const lockPath = `${path}.lock`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o644);
      try {
        writeSync(fd, String(process.pid));
      } finally {
        closeSync(fd);
      }
      held.add(lockPath);
      hookExit();
      return lockPath;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw cantOpen(path, e);
    }
    let pid = NaN;
    try {
      pid = Number(readFileSync(lockPath, 'utf8').trim());
    } catch {
      // removed between our attempt and this read: try again
    }
    if (Number.isInteger(pid) && pid > 0 && (pid === process.pid || alive(pid))) {
      const who = pid === process.pid ? 'this process' : `process ${pid}`;
      throw new NodeVfsError('SMALT_BUSY', `cannot lock ${path}: it is open in ${who} (${lockPath})`);
    }
    try {
      unlinkSync(lockPath); // left by a process that is gone
    } catch {
      // someone else took it over first: the next attempt finds their lock
    }
  }
  throw new NodeVfsError('SMALT_BUSY', `cannot lock ${path}: ${lockPath} keeps changing`);
}

function unlock(lockPath: string) {
  held.delete(lockPath);
  try {
    unlinkSync(lockPath);
  } catch {
    // already gone
  }
}

/** Makes a new file's name durable too (where the platform allows fsync on a directory). */
function syncDir(dir: string) {
  try {
    const fd = openSync(dir, 'r');
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  } catch {
    // Windows can't open a directory: its file system makes the entry durable with the file
  }
}

function cantOpen(path: string, e: unknown): NodeVfsError {
  return new NodeVfsError('SMALT_CANTOPEN', `cannot open ${path}: ${(e as Error).message}`);
}

class NodeFile implements VfsFile {
  readonly path: string;
  #fd: number | null;
  #lock: string | null;

  constructor(path: string, fd: number, lockPath: string | null) {
    this.path = path;
    this.#fd = fd;
    this.#lock = lockPath;
  }

  read(dst: Uint8Array, offset: number): number {
    const fd = this.#check();
    let done = 0;
    while (done < dst.length) {
      const n = readSync(fd, dst, done, dst.length - done, offset + done);
      if (n === 0) break; // end of file: a short read
      done += n;
    }
    return done;
  }

  write(src: Uint8Array, offset: number): number {
    const fd = this.#check();
    let done = 0;
    while (done < src.length) done += writeSync(fd, src, done, src.length - done, offset + done);
    return done;
  }

  size(): number {
    return fstatSync(this.#check()).size;
  }

  truncate(size: number): void {
    ftruncateSync(this.#check(), size);
  }

  flush(): void {
    fsyncSync(this.#check());
  }

  close(): void {
    if (this.#fd === null) return;
    closeSync(this.#fd);
    this.#fd = null;
    if (this.#lock) unlock(this.#lock);
    this.#lock = null;
  }

  #check(): number {
    if (this.#fd === null) throw new Error(`file ${this.path} is closed`);
    return this.#fd;
  }
}

/** Files on disk, for `Database.open(new NodeVfs(), path)` in Node. */
export class NodeVfs implements Vfs {
  readonly name = 'node';
  readonly root: string;

  constructor(options: NodeVfsOptions = {}) {
    this.root = resolve(options.root ?? '.');
  }

  /** The file's path on disk. */
  resolve(path: string): string {
    return resolve(this.root, path);
  }

  async open(path: string, options: OpenOptions = {}): Promise<VfsFile> {
    const full = this.resolve(path);
    const create = options.create !== false;
    if (!create && !existsSync(full)) throw new NodeVfsError('SMALT_CANTOPEN', `no such file: ${full}`);
    if (create) {
      try {
        mkdirSync(dirname(full), { recursive: true });
      } catch (e) {
        throw cantOpen(full, e);
      }
    }
    // Shared handles (parallel readers) coordinate among themselves, as OPFS's readwrite-unsafe handles do: no lock.
    const lockPath = options.shared ? null : lock(full);
    try {
      const existed = existsSync(full);
      const fd = openSync(full, constants.O_RDWR | (create ? constants.O_CREAT : 0), 0o644);
      if (!existed) syncDir(dirname(full));
      return new NodeFile(full, fd, lockPath);
    } catch (e) {
      if (lockPath) unlock(lockPath);
      throw cantOpen(full, e);
    }
  }

  async delete(path: string): Promise<void> {
    try {
      unlinkSync(this.resolve(path));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw cantOpen(this.resolve(path), e);
    }
  }

  async exists(path: string): Promise<boolean> {
    return existsSync(this.resolve(path));
  }
}
